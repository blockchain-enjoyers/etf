import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const BPS = 10_000n;

// ForwardCashQueue per-window CREATE capacity (Task 4): a net-flow cap in SHARE terms. Flow beyond the
// cap is partially filled pro-rata and the remainder rolls to the next window, staying in trustless,
// cancelable escrow (red line #1).
//
// Cap unit: capShares = totalSupply() * maxCreateFlowBps / BPS, read ONCE before any minting (vs pre-settle
// supply). Default maxCreateFlowBps == 0 disables the cap (full-fill, byte-for-byte the legacy settle).
//
// Decimals mirror ForwardCashSettle.test.ts: bootstrapped real vault supply 1e18, holdings 2e18 A / 3e18 B,
// MockNav.nav = 1e6 => navPerShare = 1e6. CREATE: cash (6-dec) -> N = netCash*1e18/navPerShare.

const FEED_ID = "0x" + "11".repeat(32);
const L2_SOURCE = "0x000000000000000000000000000000000000beef";
const NAV_SCALAR = 1_000_000n; // navPerShare 1e6 at supply 1e18

async function baseDeploy() {
  const [deployer, manager, meridian, treasury, user, user2, seeder, keeper] = await ethers.getSigners();

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  let [c0, c1] = [a, b];
  if (BigInt(t0) > BigInt(t1)) { [t0, t1] = [t1, t0]; [c0, c1] = [c1, c0]; }
  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;

  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);
  const Impl = await ethers.getContractFactory("ManagedRebalanceVault");
  const impl = await Impl.deploy();
  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]", "uint256"], [tokens, unitQty, unitSize])
  );
  const args = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [unitSize, commitment]);
  const Helper = await ethers.getContractFactory("CloneWithArgsHelper");
  const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), args);
  const vault = await ethers.getContractAt("ManagedRebalanceVault", await helper.lastClone());
  const vaultAddr = await vault.getAddress();
  await vault.initializeRebalance(tokens, unitQty, "RB", "RB", {
    manager: manager.address, meridian: meridian.address, treasury: treasury.address,
    managerFeeBps: 0, platformFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress(),
    feeToken: ethers.ZeroAddress, flatCreateFee: 0n, flatRedeemFee: 0n,
  });

  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy();
  await nav.setNav(NAV_SCALAR);
  const Obs = await ethers.getContractFactory("BasketNavObserver");
  const obs = await Obs.deploy(await nav.getAddress());
  const Router = await ethers.getContractFactory("MockFeedRouter");
  const router = await Router.deploy();
  const Agg = await ethers.getContractFactory("MockAggregator");
  const agg = await Agg.deploy();
  const Peg = await ethers.getContractFactory("MockPegFeed");
  const peg = await Peg.deploy(1_0000_0000n);
  const Usdc = await ethers.getContractFactory("MockERC20Decimals");
  const usdc = await Usdc.deploy("USDC", "USDC", 6);

  const Q = await ethers.getContractFactory("ForwardCashQueue");
  const q = await Q.deploy(
    vaultAddr, await usdc.getAddress(), await nav.getAddress(), await obs.getAddress(),
    await km.getAddress(), await router.getAddress(), await peg.getAddress(), deployer.address,
  );
  const qAddr = await q.getAddress();

  await q.setGateParams(2, 600, 200, 200, 3600);
  await q.setG1Refs(await agg.getAddress(), L2_SOURCE);
  for (const t of tokens) { await router.setFeed(t, FEED_ID); await agg.addSource(t, L2_SOURCE); }
  await km.setExecutor(qAddr, true);
  await km.setMaxRewardPerCall(ethers.MaxUint256);
  await q.setKeeperTip(0);

  async function mintApprove(tok: any, who: any, amt: bigint) {
    await tok.mint(who.address, amt);
    await tok.connect(who).approve(vaultAddr, amt);
  }

  async function reseedObs() {
    const now = await time.latest();
    await time.setNextBlockTimestamp(now + 1);
    await obs.record(vaultAddr, [], []);
    await time.setNextBlockTimestamp(now + 51);
    await obs.record(vaultAddr, [], []);
    await time.setNextBlockTimestamp(now + 101);
    await obs.record(vaultAddr, [], []);
    await peg.setUpdatedAt(await time.latest());
  }

  return {
    deployer, manager, meridian, treasury, user, user2, seeder, keeper,
    a, b, c0, c1, tokens, vault, vaultAddr, km, nav, obs, router, agg, peg, usdc, q, qAddr,
    mintApprove, reseedObs,
  };
}

async function bootstrapped() {
  const ctx = await baseDeploy();
  const { c0, c1, seeder, vault, vaultAddr, obs } = ctx;
  await ctx.mintApprove(c0, seeder, 2n * ONE);
  await ctx.mintApprove(c1, seeder, 3n * ONE);
  await vault.connect(seeder).create(ONE); // supply 1e18, holdings 2e18/3e18

  const t0 = (await time.latest()) + 1;
  await time.setNextBlockTimestamp(t0);
  await obs.record(vaultAddr, [], []);
  await time.setNextBlockTimestamp(t0 + 100);
  await obs.record(vaultAddr, [], []);
  await time.setNextBlockTimestamp(t0 + 200);
  await obs.record(vaultAddr, [], []);
  return ctx;
}

// Helper: deploy an AP filler, fund it with constituents for a create of N shares, approve the queue.
async function fundCreateAP(ctx: any, N: bigint) {
  const { vault, c0, c1, qAddr, usdc } = ctx;
  const [pTok, pAmt] = await vault.previewCreate(N);
  const Filler = await ethers.getContractFactory("MockAPFiller");
  const ap = await Filler.deploy(await usdc.getAddress());
  const apAddr = await ap.getAddress();
  for (let i = 0; i < pTok.length; i++) {
    const tok = await ethers.getContractAt("MockERC20Decimals", pTok[i]);
    await tok.mint(apAddr, pAmt[i]);
    await ap.approveConstituent(pTok[i], qAddr, pAmt[i]);
  }
  return { ap, apAddr, pTok, pAmt };
}

describe("ForwardCashQueue — per-window CREATE capacity (partial fill + roll-over)", () => {
  // 1. Cap OFF (default) == full fill (feature inert).
  it("cap OFF (default maxCreateFlowBps==0): create settles fully, exactly as legacy", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, c0, c1, usdc, user, tokens } = ctx;
    expect(await q.maxCreateFlowBps()).to.equal(0n);

    const cash = 100n * 10n ** 6n;
    const N = 100n * ONE; // netCash*1e18/navPerShare
    await usdc.mint(user.address, cash);
    await usdc.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash);

    const { apAddr } = await fundCreateAP(ctx, N);

    await time.increase(3600 + 1);
    await ctx.reseedObs();
    await expect(q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr))
      .to.emit(q, "Settled").withArgs(0n);

    expect(await vault.balanceOf(user.address)).to.equal(N);
    expect(await usdc.balanceOf(apAddr)).to.equal(cash);
    expect((await q.tickets(0n)).status).to.equal(1);
    expect(await c0.balanceOf(qAddr)).to.equal(0n);
    expect(await c1.balanceOf(qAddr)).to.equal(0n);
    expect(await usdc.balanceOf(qAddr)).to.equal(0n);
  });

  // 2. Under cap == full fill.
  it("under cap (generous maxCreateFlowBps): full fill, status 1", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, usdc, user, tokens } = ctx;
    // supply 1e18. Cap 100% (the max bps) => capShares = 1e18. Use a small create strictly UNDER the cap:
    // cash 5e5 -> N = 5e5*1e18/1e6 = 5e17 < capShares 1e18 => full fill.
    await q.setCapacity(10_000n); // 100% of supply (cap never binds for this small create)
    const cash = 5n * 10n ** 5n;
    const N = (cash * ONE) / NAV_SCALAR; // 5e17
    await usdc.mint(user.address, cash);
    await usdc.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash);

    const { apAddr } = await fundCreateAP(ctx, N);
    await time.increase(3600 + 1);
    await ctx.reseedObs();
    await expect(q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr))
      .to.emit(q, "Settled").withArgs(0n);

    expect(await vault.balanceOf(user.address)).to.equal(N);
    expect((await q.tickets(0n)).status).to.equal(1);
    expect(await usdc.balanceOf(qAddr)).to.equal(0n);
  });

  // 2b. (M-2) setCapacity upper-bound: bps > BPS reverts CapacityTooHigh; bps == BPS and 0 are valid.
  it("setCapacity reverts CapacityTooHigh above BPS; accepts BPS and 0", async () => {
    const { q } = await loadFixture(bootstrapped);
    await expect(q.setCapacity(BPS + 1n)).to.be.revertedWithCustomError(q, "CapacityTooHigh");
    await q.setCapacity(BPS); // exactly 100% allowed
    expect(await q.maxCreateFlowBps()).to.equal(BPS);
    await q.setCapacity(0n);  // off
    expect(await q.maxCreateFlowBps()).to.equal(0n);
  });

  // 3. Over cap == pro-rata partial fill + roll-over across windows.
  it("over cap: partial fill (pro-rata), ticket stays pending with reduced amount, then second window fills the rest", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, c0, c1, usdc, user, tokens } = ctx;
    // supply 1e18; cap 100% => capShares = 1e18. A create of cash 2e6 -> N = 2e18 > capShares 1e18.
    await q.setCapacity(10_000n); // 100% of supply => capShares 1e18
    const cash = 2n * 10n ** 6n; // requests N = 2e18
    const reqN = 2n * ONE;
    const capShares = 1n * ONE;
    // f = capShares/reqN = 1/2. fillCash = cash * capShares / reqN = 2e6 * 1e18 / 2e18 = 1e6.
    const fillCash = (cash * capShares) / reqN; // 1e6
    // filled N for fillCash: netCash 1e6 -> 1e6*1e18/1e6 = 1e18 shares.
    const filledN = 1n * ONE;

    await usdc.mint(user.address, cash);
    await usdc.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash);

    // AP only needs to cover the FILLED N this window.
    const { apAddr } = await fundCreateAP(ctx, filledN);
    await time.increase(3600 + 1);
    await ctx.reseedObs();

    const apUsdcBefore = await usdc.balanceOf(apAddr);
    await q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr);

    // user got the PARTIAL shares.
    expect(await vault.balanceOf(user.address)).to.equal(filledN);
    // AP got the PARTIAL cash.
    expect(await usdc.balanceOf(apAddr) - apUsdcBefore).to.equal(fillCash);
    // ticket STILL PENDING, amount reduced by exactly fillCash.
    const t = await q.tickets(0n);
    expect(t.status).to.equal(0);
    expect(t.amount).to.equal(cash - fillCash); // 1e6 remainder
    // queue still escrows the remaining cash.
    expect(await usdc.balanceOf(qAddr)).to.equal(cash - fillCash);
    // queue holds no constituents (filled portion transited atomically).
    expect(await c0.balanceOf(qAddr)).to.equal(0n);
    expect(await c1.balanceOf(qAddr)).to.equal(0n);

    // --- SECOND WINDOW: the remainder fills fully now. NOTE supply doubled (filledN minted), so navPerShare
    // halved to 5e5; the remainder cash 1e6 mints remN = netCash*1e18/navPerShare = 1e6*1e18/5e5 = 2e18.
    // capShares (recomputed vs the new supply 2e18 at 100%) = 2e18 >= remN, so it's under cap => full fill.
    const remCash = cash - fillCash; // 1e6
    await time.increase(3600 + 1);
    await ctx.reseedObs();
    const navPS2 = await q.settleGateView.staticCall(tokens, [[], []]); // 5e5
    const remN = (remCash * ONE) / navPS2; // 2e18
    const { apAddr: apAddr2 } = await fundCreateAP(ctx, remN);

    const ap2Before = await usdc.balanceOf(apAddr2);
    await expect(q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr2))
      .to.emit(q, "Settled").withArgs(0n);

    expect(await vault.balanceOf(user.address)).to.equal(filledN + remN);
    expect(await usdc.balanceOf(apAddr2) - ap2Before).to.equal(remCash);
    expect((await q.tickets(0n)).status).to.equal(1); // now fully settled
    expect(await usdc.balanceOf(qAddr)).to.equal(0n);
  });

  // 4. Pro-rata across two tickets: both filled by the SAME fraction f.
  it("pro-rata across two create tickets: each filled by the same fraction, both left pending reduced", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, usdc, user, user2, tokens } = ctx;
    // supply 1e18, cap 100% => capShares 1e18.
    await q.setCapacity(10_000n);
    const cash1 = 1n * 10n ** 6n;  // N1 = 1e18
    const cash2 = 3n * 10n ** 6n;  // N2 = 3e18
    const reqN = 4n * ONE;         // total 4e18
    const capShares = 1n * ONE;    // f = 1/4

    await usdc.mint(user.address, cash1);
    await usdc.connect(user).approve(qAddr, cash1);
    await q.connect(user).requestCreate(cash1); // id 0

    await usdc.mint(user2.address, cash2);
    await usdc.connect(user2).approve(qAddr, cash2);
    await q.connect(user2).requestCreate(cash2); // id 1

    const fillCash1 = (cash1 * capShares) / reqN; // 1e6 * 1e18 / 4e18 = 250000
    const fillCash2 = (cash2 * capShares) / reqN; // 3e6 * 1e18 / 4e18 = 750000
    const filledN1 = (fillCash1 * ONE) / NAV_SCALAR; // 250000*1e18/1e6 = 0.25e18
    const filledN2 = (fillCash2 * ONE) / NAV_SCALAR; // 0.75e18

    // Total filled shares must be <= capShares.
    expect(filledN1 + filledN2).to.be.lte(capShares);

    // Fund a single AP covering filledN1 + filledN2 worth of constituents.
    const { apAddr } = await fundCreateAP(ctx, filledN1 + filledN2);
    await time.increase(3600 + 1);
    await ctx.reseedObs();

    await q.connect(ctx.keeper).settle([0n, 1n], tokens, [[], []], apAddr);

    expect(await vault.balanceOf(user.address)).to.equal(filledN1);
    expect(await vault.balanceOf(user2.address)).to.equal(filledN2);

    const t0 = await q.tickets(0n);
    const t1 = await q.tickets(1n);
    expect(t0.status).to.equal(0);
    expect(t1.status).to.equal(0);
    expect(t0.amount).to.equal(cash1 - fillCash1);
    expect(t1.amount).to.equal(cash2 - fillCash2);
    // Same fraction f: fillCash_i / cash_i equal (1/4) for both.
    expect(fillCash1 * cash2).to.equal(fillCash2 * cash1);
    // queue escrows the two remainders.
    expect(await usdc.balanceOf(qAddr)).to.equal((cash1 - fillCash1) + (cash2 - fillCash2));
  });

  // 4b. (C1) A tight cap + one tiny ticket alongside a normal one in a single settle must NOT revert
  //     ZeroShares (no batch brick). The tiny ticket gets a 0 slice -> skipped + left pending; the normal
  //     ticket fills (partially); the keeper is still paid for the real work.
  it("C1 no-brick: tiny dust ticket gets a 0 slice and is skipped, the batch does NOT revert ZeroShares", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, usdc, user, user2, tokens } = ctx;
    await q.setCapacity(1n); // 1bps => capShares 1e14
    const capShares = (1n * ONE) / BPS; // 1e14
    const bigCash = 100n * 10n ** 6n;   // N = 100e18
    const tinyCash = 1n;                // 1 micro-USDC

    await usdc.mint(user.address, bigCash);
    await usdc.connect(user).approve(qAddr, bigCash);
    await q.connect(user).requestCreate(bigCash); // id 0
    await usdc.mint(user2.address, tinyCash);
    await usdc.connect(user2).approve(qAddr, tinyCash);
    await q.connect(user2).requestCreate(tinyCash); // id 1

    const reqN = (bigCash * ONE) / NAV_SCALAR + (tinyCash * ONE) / NAV_SCALAR;
    const bigFill = (bigCash * capShares) / reqN;
    const tinyFill = (tinyCash * capShares) / reqN;
    expect(tinyFill).to.equal(0n);
    const bigFilledN = (bigFill * ONE) / NAV_SCALAR; // spread 0

    const { apAddr } = await fundCreateAP(ctx, bigFilledN);
    await time.increase(3600 + 1);
    await ctx.reseedObs();

    // Does NOT revert (the old code reverted ZeroShares here).
    await expect(q.connect(ctx.keeper).settle([0n, 1n], tokens, [[], []], apAddr)).to.not.be.reverted;

    // id 0 partially filled (pending), id 1 skipped untouched (pending, full escrow).
    expect((await q.tickets(0n)).status).to.equal(0);
    expect((await q.tickets(1n)).status).to.equal(0);
    expect((await q.tickets(1n)).amount).to.equal(tinyCash);
    expect(await vault.balanceOf(user.address)).to.equal(bigFilledN);
    expect(await vault.balanceOf(user2.address)).to.equal(0n);
  });

  // 4c. (nice-to-have) 3 create tickets summing to EXACTLY cap -> all fill fully, sum of minted shares <= cap.
  it("three tickets summing to exactly cap: all fill fully, minted shares sum <= capShares", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, usdc, user, user2, seeder, tokens } = ctx;
    // capShares = 1e18 (100% of supply). Three creates whose N sums to exactly 1e18.
    await q.setCapacity(10_000n);
    const capShares = 1n * ONE;
    // cash -> N = cash*1e18/1e6 = cash*1e12. Pick N's 0.2e18, 0.3e18, 0.5e18 (sum 1e18).
    const cashes = [200_000n, 300_000n, 500_000n]; // micro-USDC; N = 0.2e18,0.3e18,0.5e18
    const Ns = cashes.map((c) => (c * ONE) / NAV_SCALAR);
    expect(Ns[0] + Ns[1] + Ns[2]).to.equal(capShares);

    const signers = [user, user2, seeder];
    for (let i = 0; i < 3; i++) {
      await usdc.mint(signers[i].address, cashes[i]);
      await usdc.connect(signers[i]).approve(qAddr, cashes[i]);
      await q.connect(signers[i]).requestCreate(cashes[i]); // ids 0,1,2
    }

    const { apAddr } = await fundCreateAP(ctx, Ns[0] + Ns[1] + Ns[2]);
    await time.increase(3600 + 1);
    await ctx.reseedObs();
    await q.connect(ctx.keeper).settle([0n, 1n, 2n], tokens, [[], []], apAddr);

    // totalReqShares == capShares => NOT over cap => all full fill (status 1).
    for (let i = 0; i < 3; i++) expect((await q.tickets(BigInt(i))).status).to.equal(1);
    const minted = (await vault.balanceOf(user.address)) + (await vault.balanceOf(user2.address))
      + ((await vault.balanceOf(seeder.address)) - ONE); // subtract seeder's bootstrap 1e18
    expect(minted).to.equal(Ns[0] + Ns[1] + Ns[2]);
    expect(minted).to.be.lte(capShares);
  });

  // 5. (C2) Partial-fill remainder is cancelable: its cutoff was REFRESHED on the defer, so the owner can
  //    cancel the rolled-over remainder right after the settle and gets back EXACTLY the reduced amount.
  it("partial-fill remainder is cancelable (refreshed cutoff): owner gets back the reduced amount exactly", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, usdc, user, tokens } = ctx;
    await q.setCapacity(10_000n); // capShares 1e18
    const cash = 2n * 10n ** 6n;  // N 2e18 > cap
    const reqN = 2n * ONE;
    const capShares = 1n * ONE;
    const fillCash = (cash * capShares) / reqN; // 1e6
    const filledN = 1n * ONE;
    const remainder = cash - fillCash;

    await usdc.mint(user.address, cash);
    await usdc.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash);

    const { apAddr } = await fundCreateAP(ctx, filledN);
    await time.increase(3600 + 1); // past the original cutoff
    await ctx.reseedObs();

    const settleBlockTime = (await time.latest()) + 1;
    await time.setNextBlockTimestamp(settleBlockTime);
    await q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr);

    const t = await q.tickets(0n);
    expect(t.status).to.equal(0);
    expect(t.amount).to.equal(remainder);
    // C2: cutoff refreshed to settleBlockTime + cutoffDelay (default 1h) -> in the FUTURE now.
    expect(t.cutoff).to.equal(BigInt(settleBlockTime) + 3600n);

    // The owner can now cancel the rolled-over remainder and recover exactly the reduced escrow.
    const userBefore = await usdc.balanceOf(user.address);
    await q.connect(user).cancel(0n);
    expect(await usdc.balanceOf(user.address) - userBefore).to.equal(remainder);
    expect((await q.tickets(0n)).status).to.equal(2); // cancelled
    expect(await usdc.balanceOf(qAddr)).to.equal(0n); // queue emptied; non-custody
  });

  // 5b. (C1) A zero-fill skip also refreshes the cutoff, so a dust ticket the cap starved this window is
  //     still cancelable: the owner recovers its full (unchanged) escrow.
  it("zero-fill skipped ticket is cancelable (refreshed cutoff): owner recovers the full escrow", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, usdc, user, user2, tokens } = ctx;
    // Tight cap of 1bps: capShares = 1e18 * 1 / 10000 = 1e14.
    await q.setCapacity(1n);
    const capShares = (1n * ONE * 1n) / BPS; // 1e14
    // A big create (id 0) so totalReqShares is large, and a tiny create (id 1) that floors to a 0 slice.
    const bigCash = 100n * 10n ** 6n; // N = 100e18
    const tinyCash = 1n;              // 1 micro-USDC -> N = 1e12; slice floors to 0 under this cap
    await usdc.mint(user.address, bigCash);
    await usdc.connect(user).approve(qAddr, bigCash);
    await q.connect(user).requestCreate(bigCash); // id 0
    await usdc.mint(user2.address, tinyCash);
    await usdc.connect(user2).approve(qAddr, tinyCash);
    await q.connect(user2).requestCreate(tinyCash); // id 1

    // reqN ~= 100e18 + 1e12; tiny slice = tinyCash*capShares/reqN = floor(1 * 1e14 / ~100e18) = 0.
    const reqN = (bigCash * ONE) / NAV_SCALAR + (tinyCash * ONE) / NAV_SCALAR;
    const bigFill = (bigCash * capShares) / reqN;
    const tinyFill = (tinyCash * capShares) / reqN;
    expect(tinyFill).to.equal(0n); // the tiny ticket gets a ZERO slice this window

    const bigFilledN = ((bigFill * (BPS - 0n)) / BPS * ONE) / NAV_SCALAR;
    const { apAddr } = await fundCreateAP(ctx, bigFilledN);
    await time.increase(3600 + 1);
    await ctx.reseedObs();

    const settleBlockTime = (await time.latest()) + 1;
    await time.setNextBlockTimestamp(settleBlockTime);
    // Must NOT revert (no ZeroShares brick); big ticket partially fills, tiny ticket is skipped + cutoff-refreshed.
    await q.connect(ctx.keeper).settle([0n, 1n], tokens, [[], []], apAddr);

    // id 1 untouched escrow, still pending, cutoff refreshed.
    const t1 = await q.tickets(1n);
    expect(t1.status).to.equal(0);
    expect(t1.amount).to.equal(tinyCash);
    expect(t1.cutoff).to.equal(BigInt(settleBlockTime) + 3600n);

    // The owner of the starved dust ticket can cancel and recover its full escrow.
    const u2Before = await usdc.balanceOf(user2.address);
    await q.connect(user2).cancel(1n);
    expect(await usdc.balanceOf(user2.address) - u2Before).to.equal(tinyCash);
    expect((await q.tickets(1n)).status).to.equal(2);
  });

  // 6. Floor-dust accrues to remaining holders (red-line), asserted in a capacity context redeem.
  it("floor-dust on redeem accrues to the vault (remaining holders), not the AP/Meridian", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, vaultAddr, c0, c1, usdc, user, seeder, tokens } = ctx;
    // Capacity ON does not cap redeems (v1). Donate odd dust so holdings*N is not divisible by supply.
    await q.setCapacity(10_000n);
    await c0.mint(seeder.address, 3n);
    await c1.mint(seeder.address, 1n);
    await c0.connect(seeder).transfer(vaultAddr, 3n);
    await c1.connect(seeder).transfer(vaultAddr, 1n);

    const holdA = await c0.balanceOf(vaultAddr);
    const holdB = await c1.balanceOf(vaultAddr);
    const supply = await vault.totalSupply();
    const N = ONE / 2n;
    const exactA = (holdA * N) / supply;
    const exactB = (holdB * N) / supply;
    const dustA = (holdA * N) % supply;
    const dustB = (holdB * N) % supply;
    expect(dustA > 0n || dustB > 0n).to.equal(true);

    await vault.connect(seeder).transfer(user.address, N);
    await vault.connect(user).approve(qAddr, N);
    await q.connect(user).requestRedeem(N);

    const Filler = await ethers.getContractFactory("MockAPFiller");
    const ap = await Filler.deploy(await usdc.getAddress());
    const apAddr = await ap.getAddress();
    const cashOut = (N * NAV_SCALAR) / ONE;
    await usdc.mint(apAddr, cashOut);

    await time.increase(3600 + 1);
    await ctx.reseedObs();
    await q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr);

    // AP got exactly the floor; the vault kept the sub-unit remainder for remaining holders.
    expect(await c0.balanceOf(apAddr)).to.equal(exactA);
    expect(await c1.balanceOf(apAddr)).to.equal(exactB);
    expect(await c0.balanceOf(vaultAddr)).to.equal(holdA - exactA);
    expect(await c1.balanceOf(vaultAddr)).to.equal(holdB - exactB);
    expect((await q.tickets(0n)).status).to.equal(1);
  });
});
