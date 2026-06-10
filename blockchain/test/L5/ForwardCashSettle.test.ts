import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

// ForwardCashQueue.settle — the red-line-critical create+redeem flows against a REAL ManagedRebalanceVault.
//
// Decimals/arithmetic (documented, wei-exact):
//   - REAL vault bootstrapped with create(ONE) => totalSupply = 1e18, holdings 2e18 A / 3e18 B.
//   - MockNav.nav = 1e6 (a scaled "scalar"). The gate computes navPerShare = nav*1e18/totalSupply
//     = 1e6 * 1e18 / 1e18 = 1e6. So navPerShare = 1e6.
//   - The observer samples the SAME nav against the SAME real vault, so the in-window TWAP = 1e6 too
//     (struck navPerShare == TWAP, g7 band trivially satisfied).
//   - CREATE: cash = 100e6 (6-dec USDC), spreadBps = 0 => netCash = 100e6.
//       N = netCash*1e18/navPerShare = 100e6 * 1e18 / 1e6 = 100e18 shares.
//     previewCreate(100e18) post-bootstrap (managerFeeBps=0 => no pending mint), pro-rata Ceil over
//     holdings 2e18/3e18 at supply 1e18:
//       amtA = ceil(2e18 * 100e18 / 1e18) = 200e18 ; amtB = ceil(3e18 * 100e18 / 1e18) = 300e18.
//     All integers — no rounding fudge.
//   - REDEEM: user holds 5e17 shares. cashOut = (5e17 * 1e6 / 1e18) * (BPS-0)/BPS = 5e5 (0.5 USDC).
//     redeem(5e17) deltas over holdings 2e18/3e18 at supply 1e18 (floor): 1e18 A, 1.5e18 B (integers).

const FEED_ID = "0x" + "11".repeat(32);
const L2_SOURCE = "0x000000000000000000000000000000000000beef";

const NAV_SCALAR = 1_000_000n; // 1e6 -> navPerShare 1e6 at supply 1e18

async function baseDeploy() {
  const [deployer, manager, meridian, treasury, user, seeder, keeper] = await ethers.getSigners();

  // Two constituents, sorted by address (the vault target recipe must be sorted-by-address valid).
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  let [c0, c1] = [a, b];
  if (BigInt(t0) > BigInt(t1)) { [t0, t1] = [t1, t0]; [c0, c1] = [c1, c0]; }
  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;

  // KeeperModule + a real ManagedRebalanceVault clone.
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

  // Gate price path mocks.
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
  const peg = await Peg.deploy(1_0000_0000n); // $1.00 @ 8dec
  const Usdc = await ethers.getContractFactory("MockERC20Decimals");
  const usdc = await Usdc.deploy("USDC", "USDC", 6);

  const Q = await ethers.getContractFactory("ForwardCashQueue");
  const q = await Q.deploy(
    vaultAddr,
    await usdc.getAddress(),
    await nav.getAddress(),
    await obs.getAddress(),
    await km.getAddress(),
    await router.getAddress(),
    await peg.getAddress(),
    deployer.address,
  );
  const qAddr = await q.getAddress();

  await q.setGateParams(2, 600, 200, 200, 3600);
  await q.setG1Refs(await agg.getAddress(), L2_SOURCE);
  for (const t of tokens) {
    await router.setFeed(t, FEED_ID);
    await agg.addSource(t, L2_SOURCE);
  }

  // Register the queue as a KeeperModule executor (NOT a vault executor — never call vault.setExecutor).
  await km.setExecutor(qAddr, true);
  await km.setMaxRewardPerCall(ethers.MaxUint256);
  await q.setKeeperTip(0); // escrow empty (managerFeeBps=0) -> clamps to 0; still exercises the pay path.

  async function mintApprove(tok: any, who: any, amt: bigint) {
    await tok.mint(who.address, amt);
    await tok.connect(who).approve(vaultAddr, amt);
  }

  // Re-seed >=2 Open+safe observations in the LAST `window` seconds so the g6/g7 consult passes
  // right now (call AFTER any time jump past the cutoff; the gate's window is 600s).
  async function reseedObs() {
    const now = await time.latest();
    await time.setNextBlockTimestamp(now + 1);
    await obs.record(vaultAddr, [], []);
    await time.setNextBlockTimestamp(now + 51);
    await obs.record(vaultAddr, [], []);
    await time.setNextBlockTimestamp(now + 101);
    await obs.record(vaultAddr, [], []);
    // Refresh the peg freshness (g8) past the time jump so settle isn't blocked by PegStale.
    await peg.setUpdatedAt(await time.latest());
  }

  return {
    deployer, manager, meridian, treasury, user, seeder, keeper,
    a, b, c0, c1, tokens, vault, vaultAddr, km, nav, obs, router, agg, peg, usdc, q, qAddr,
    mintApprove, reseedObs,
  };
}

// Bootstrap the real vault in-kind to supply 1e18 (holdings 2e18 A / 3e18 B) and seed the observer
// with >=2 Open+safe prints so the g6/g7 gate passes.
async function bootstrapped() {
  const ctx = await baseDeploy();
  const { c0, c1, seeder, vault, vaultAddr, obs } = ctx;
  await ctx.mintApprove(c0, seeder, 2n * ONE);
  await ctx.mintApprove(c1, seeder, 3n * ONE);
  await vault.connect(seeder).create(ONE); // supply 1e18, holdings 2e18/3e18

  // >=2 Open+safe observations against the REAL vault.
  const t0 = (await time.latest()) + 1;
  await time.setNextBlockTimestamp(t0);
  await obs.record(vaultAddr, [], []); // seed (discarded)
  await time.setNextBlockTimestamp(t0 + 100);
  await obs.record(vaultAddr, [], []);
  await time.setNextBlockTimestamp(t0 + 200);
  await obs.record(vaultAddr, [], []); // twap == 1e6
  return ctx;
}

describe("ForwardCashQueue — settle create/redeem flows", () => {
  it("gate sanity: navPerShare == 1e6 on the bootstrapped real vault", async () => {
    const { q, tokens } = await loadFixture(bootstrapped);
    expect(await q.settleGateView.staticCall(tokens, [[], []])).to.equal(NAV_SCALAR);
  });

  it("CREATE: user gets N shares, AP keeps full ticket cash, no queue constituent leftover", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, vaultAddr, c0, c1, usdc, user, tokens } = ctx;
    const cash = 100n * 10n ** 6n; // 100e6 USDC
    const N = 100n * ONE;          // netCash*1e18/navPerShare = 100e6*1e18/1e6
    const amtA = 200n * ONE, amtB = 300n * ONE; // previewCreate(N)

    // user escrows cash
    await usdc.mint(user.address, cash);
    await usdc.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash);
    const id = 0n;

    // AP funded with the create constituents + pre-approves the queue.
    const Filler = await ethers.getContractFactory("MockAPFiller");
    const ap = await Filler.deploy(await usdc.getAddress());
    const apAddr = await ap.getAddress();
    await c0.mint(apAddr, amtA);
    await c1.mint(apAddr, amtB);
    await ap.approveConstituent(await c0.getAddress(), qAddr, amtA);
    await ap.approveConstituent(await c1.getAddress(), qAddr, amtB);

    await time.increase(3600 + 1); // past cutoff (default 1h)
    await ctx.reseedObs();

    const apUsdcBefore = await usdc.balanceOf(apAddr);
    await expect(q.connect(ctx.keeper).settle([id], tokens, [[], []], apAddr))
      .to.emit(q, "Settled").withArgs(id);

    // user received N shares
    expect(await vault.balanceOf(user.address)).to.equal(N);
    // AP got the FULL ticket cash (keeps spread)
    expect(await usdc.balanceOf(apAddr) - apUsdcBefore).to.equal(cash);
    // NON-CUSTODY: queue holds no constituents and no stable
    expect(await c0.balanceOf(qAddr)).to.equal(0n);
    expect(await c1.balanceOf(qAddr)).to.equal(0n);
    expect(await usdc.balanceOf(qAddr)).to.equal(0n);
    // vault pulled exactly amtA/amtB
    expect(await c0.balanceOf(vaultAddr)).to.equal(2n * ONE + amtA);
    expect(await c1.balanceOf(vaultAddr)).to.equal(3n * ONE + amtB);
    // ticket settled
    const t = await q.tickets(id);
    expect(t.status).to.equal(1);
  });

  it("REDEEM: user paid cashOut, AP gets the pro-rata constituents, floor-dust stays in vault", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, vaultAddr, c0, c1, usdc, user, seeder, tokens } = ctx;
    const N = ONE / 2n; // 5e17 shares
    const cashOut = (N * NAV_SCALAR) / ONE; // 5e5 (0.5 USDC), spread 0
    const dA = 1n * ONE;          // floor(2e18 * 5e17 / 1e18)
    const dB = 15n * ONE / 10n;   // floor(3e18 * 5e17 / 1e18) = 1.5e18

    // seeder gives the user shares; user escrows them.
    await vault.connect(seeder).transfer(user.address, N);
    await vault.connect(user).approve(qAddr, N);
    await q.connect(user).requestRedeem(N);
    const id = 0n;

    // AP funded with USDC to pay cashOut.
    const Filler = await ethers.getContractFactory("MockAPFiller");
    const ap = await Filler.deploy(await usdc.getAddress());
    const apAddr = await ap.getAddress();
    await usdc.mint(apAddr, cashOut);

    await time.increase(3600 + 1);
    await ctx.reseedObs();

    const vaultABefore = await c0.balanceOf(vaultAddr);
    const vaultBBefore = await c1.balanceOf(vaultAddr);

    await expect(q.connect(ctx.keeper).settle([id], tokens, [[], []], apAddr))
      .to.emit(q, "Settled").withArgs(id);

    // user paid exactly cashOut
    expect(await usdc.balanceOf(user.address)).to.equal(cashOut);
    // AP received the pro-rata constituent deltas
    expect(await c0.balanceOf(apAddr)).to.equal(dA);
    expect(await c1.balanceOf(apAddr)).to.equal(dB);
    // floor-dust / remainder stays in the vault: vault retained holdings - delta exactly (AP got floor only)
    expect(await c0.balanceOf(vaultAddr)).to.equal(vaultABefore - dA);
    expect(await c1.balanceOf(vaultAddr)).to.equal(vaultBBefore - dB);
    // NON-CUSTODY: queue holds nothing afterwards
    expect(await c0.balanceOf(qAddr)).to.equal(0n);
    expect(await c1.balanceOf(qAddr)).to.equal(0n);
    expect(await vault.balanceOf(qAddr)).to.equal(0n); // escrowed N was burned by redeem
    // ticket settled
    const t = await q.tickets(id);
    expect(t.status).to.equal(1);
  });

  it("VaultNotBootstrapped: settle reverts on a fresh zero-supply vault", async () => {
    // Use the non-bootstrapped base context: real vault totalSupply == 0.
    const { q, tokens } = await loadFixture(baseDeploy);
    await expect(q.settle([], tokens, [[], []], ethers.ZeroAddress))
      .to.be.revertedWithCustomError(q, "VaultNotBootstrapped");
  });

  it("under-deliver (create): AP approves LESS than previewCreate(N) -> settle reverts", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, c0, c1, usdc, user, tokens } = ctx;
    const cash = 100n * 10n ** 6n;
    const amtA = 200n * ONE, amtB = 300n * ONE;

    await usdc.mint(user.address, cash);
    await usdc.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash);

    const Filler = await ethers.getContractFactory("MockAPFiller");
    const ap = await Filler.deploy(await usdc.getAddress());
    const apAddr = await ap.getAddress();
    await c0.mint(apAddr, amtA);
    await c1.mint(apAddr, amtB);
    // Approve A in full but B SHORT by 1 wei -> the exact pull fails.
    await ap.approveConstituent(await c0.getAddress(), qAddr, amtA);
    await ap.approveConstituent(await c1.getAddress(), qAddr, amtB - 1n);

    await time.increase(3600 + 1);
    await ctx.reseedObs();
    await expect(q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr)).to.be.reverted;
  });

  it("underpay (redeem): AP onRedeem pays cashOut-1 -> settle reverts APUnderpaid", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, usdc, user, seeder, tokens } = ctx;
    const N = ONE / 2n;
    const cashOut = (N * NAV_SCALAR) / ONE;

    await vault.connect(seeder).transfer(user.address, N);
    await vault.connect(user).approve(qAddr, N);
    await q.connect(user).requestRedeem(N);

    const Filler = await ethers.getContractFactory("MockAPFiller");
    const ap = await Filler.deploy(await usdc.getAddress());
    const apAddr = await ap.getAddress();
    await usdc.mint(apAddr, cashOut);
    await ap.setShortfall(1n); // pays cashOut - 1

    await time.increase(3600 + 1);
    await ctx.reseedObs();
    await expect(q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr))
      .to.be.revertedWithCustomError(q, "APUnderpaid");
  });

  it("spread: spreadBps applied to both create N and redeem cashOut", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, c0, c1, usdc, user, tokens } = ctx;
    await q.setSpreadBps(100); // 1%
    const cash = 100n * 10n ** 6n;
    const BPS = 10_000n;
    const netCash = (cash * (BPS - 100n)) / BPS; // 99e6
    const N = (netCash * ONE) / NAV_SCALAR;      // 99e18
    // previewCreate(99e18): ceil(2e18*99e18/1e18)=198e18 ; ceil(3e18*99e18/1e18)=297e18
    const amtA = 198n * ONE, amtB = 297n * ONE;

    await usdc.mint(user.address, cash);
    await usdc.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash);

    const Filler = await ethers.getContractFactory("MockAPFiller");
    const ap = await Filler.deploy(await usdc.getAddress());
    const apAddr = await ap.getAddress();
    await c0.mint(apAddr, amtA);
    await c1.mint(apAddr, amtB);
    await ap.approveConstituent(await c0.getAddress(), qAddr, amtA);
    await ap.approveConstituent(await c1.getAddress(), qAddr, amtB);

    await time.increase(3600 + 1);
    await ctx.reseedObs();
    await q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr);
    expect(await vault.balanceOf(user.address)).to.equal(N);
    // AP still keeps the FULL ticket cash (spread is the AP's margin, not a Meridian cut).
    expect(await usdc.balanceOf(apAddr)).to.equal(cash);
  });

  it("setSpreadBps over MAX_SPREAD_BPS reverts SpreadTooHigh", async () => {
    const { q } = await loadFixture(baseDeploy);
    await expect(q.setSpreadBps(201)).to.be.revertedWithCustomError(q, "SpreadTooHigh");
    await q.setSpreadBps(200); // exactly at the cap is allowed
  });

  // Invariant 6 (red line): non-zero floor-dust on redeem stays in the vault (accrues to remaining
  // holders), never to the AP/Meridian. Force a real sub-unit remainder by donating ODD amounts to the
  // vault so holdings*N is NOT divisible by supply, then assert the AP got EXACTLY the FLOOR delta
  // (== previewRedeem(N)) and the vault retained the strictly-positive remainder.
  it("REDEEM non-zero dust: AP gets exactly floor(previewRedeem); the sub-unit remainder stays in the vault", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, vaultAddr, c0, c1, usdc, user, seeder, tokens } = ctx;

    // Donate odd dust directly to the vault holdings (supply unchanged at 1e18).
    await c0.mint(seeder.address, 3n);
    await c1.mint(seeder.address, 1n);
    await c0.connect(seeder).transfer(vaultAddr, 3n); // holdings A = 2e18 + 3
    await c1.connect(seeder).transfer(vaultAddr, 1n); // holdings B = 3e18 + 1

    const holdA = await c0.balanceOf(vaultAddr); // 2e18+3
    const holdB = await c1.balanceOf(vaultAddr); // 3e18+1
    const supply = await vault.totalSupply();    // 1e18
    const N = ONE / 2n;                           // 5e17

    // Exact (non-floored) pro-rata and the FLOOR the vault.redeem actually pays.
    const exactA = (holdA * N) / supply;          // 1e18 + 1 (floor of (2e18+3)/2 = 1e18+1.5)
    const exactB = (holdB * N) / supply;          // 1.5e18 (floor of (3e18+1)/2 = 1.5e18+0.5)
    // The fractional remainder must be strictly positive on at least one leg (real dust).
    expect((holdA * N) % supply > 0n || (holdB * N) % supply > 0n).to.equal(true);

    // previewRedeem(N) must match the floor delta the queue forwards.
    const [, pv] = await vault.previewRedeem(N);
    // tokens are [t0,t1]; previewRedeem returns over _held in the same order as heldTokens()
    const heldOrder = await vault.heldTokens();
    const idxA = heldOrder[0].toLowerCase() === (await c0.getAddress()).toLowerCase() ? 0 : 1;
    const idxB = 1 - idxA;
    expect(pv[idxA]).to.equal(exactA);
    expect(pv[idxB]).to.equal(exactB);

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

    // AP received EXACTLY the floor pro-rata delta.
    expect(await c0.balanceOf(apAddr)).to.equal(exactA);
    expect(await c1.balanceOf(apAddr)).to.equal(exactB);
    // The sub-unit remainder (dust) STAYED in the vault: holdings - floor delta.
    expect(await c0.balanceOf(vaultAddr)).to.equal(holdA - exactA);
    expect(await c1.balanceOf(vaultAddr)).to.equal(holdB - exactB);
    // The redeemer was paid the FLOOR, which is strictly less than its exact pro-rata claim on the dusty
    // leg(s): that floored-away fraction is the dust the vault kept for remaining holders.
    const fairA = (holdA * N) / supply; // integer floor == exactA here; rounding-away amount is the modulo
    const dustA = (holdA * N) % supply; // > 0 means a fractional unit was floored into the vault
    const dustB = (holdB * N) % supply;
    expect(dustA > 0n || dustB > 0n).to.equal(true);  // genuine dust exists
    expect(exactA).to.equal(fairA);                    // AP paid the floor, not the ceil
    // queue holds nothing
    expect(await c0.balanceOf(qAddr)).to.equal(0n);
    expect(await c1.balanceOf(qAddr)).to.equal(0n);
    expect(await usdc.balanceOf(user.address)).to.equal(cashOut);
  });

  // The keeper tip is paid from the KeeperModule SHARE escrow (a fee on assets) and CLAMPED to
  // min(requested, escrow, maxRewardPerCall) — never a cut of flow. Fund the escrow with vault shares,
  // request more than the cap, and assert the keeper received exactly the clamped amount.
  it("keeper tip: paid from the share escrow and clamped to min(tip, escrow, cap)", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, vaultAddr, km, c0, c1, usdc, user, seeder, keeper, tokens } = ctx;

    // Fund the KeeperModule escrow with vault shares (the seeder holds 1e18 from bootstrap).
    const escrow = 100n;
    const kmAddr = await km.getAddress();
    await vault.connect(seeder).transfer(kmAddr, escrow);
    expect(await km.escrowOf(vaultAddr)).to.equal(escrow);

    const tip = 50n;   // requested
    const cap = 30n;   // per-call ceiling < tip  => clamp binds on the cap
    await q.setKeeperTip(tip);
    await km.setMaxRewardPerCall(cap);

    // A create ticket so settle runs the pay path (create does not touch the escrow's vault-share balance).
    const cash = 100n * 10n ** 6n;
    const N = 100n * ONE;
    const amtA = 200n * ONE, amtB = 300n * ONE;
    await usdc.mint(user.address, cash);
    await usdc.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash);

    const Filler = await ethers.getContractFactory("MockAPFiller");
    const ap = await Filler.deploy(await usdc.getAddress());
    const apAddr = await ap.getAddress();
    await c0.mint(apAddr, amtA);
    await c1.mint(apAddr, amtB);
    await ap.approveConstituent(await c0.getAddress(), qAddr, amtA);
    await ap.approveConstituent(await c1.getAddress(), qAddr, amtB);

    await time.increase(3600 + 1);
    await ctx.reseedObs();

    const keeperBefore = await vault.balanceOf(keeper.address);
    await q.connect(keeper).settle([0n], tokens, [[], []], apAddr);

    // paid == min(tip=50, escrow=100, cap=30) == 30, transferred from the escrow to the keeper.
    expect(await vault.balanceOf(keeper.address) - keeperBefore).to.equal(30n);
    expect(await km.escrowOf(vaultAddr)).to.equal(escrow - 30n); // 70 left in escrow
  });

  // Loop semantics (invariant 7): one settle over a mixed batch — a past-cutoff create, a past-cutoff
  // redeem, a still-pre-cutoff ticket, and an already-closed (cancelled) ticket. Only the two past-cutoff
  // pending tickets settle; the pre-cutoff one is skipped (untouched), the closed one is skipped (no
  // double-spend).
  it("multi-ticket batch: settles past-cutoff pendings, skips pre-cutoff and already-closed", async () => {
    const ctx = await loadFixture(bootstrapped);
    const { q, qAddr, vault, c0, c1, usdc, user, seeder, tokens } = ctx;

    // --- id 0: create, past cutoff ---
    const cash = 100n * 10n ** 6n;
    const Ncreate = 100n * ONE;
    const amtA = 200n * ONE, amtB = 300n * ONE;
    await usdc.mint(user.address, cash);
    await usdc.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash); // id 0

    // --- id 1: redeem, past cutoff ---
    const Nredeem = ONE / 2n;
    const cashOut = (Nredeem * NAV_SCALAR) / ONE;
    await vault.connect(seeder).transfer(user.address, Nredeem);
    await vault.connect(user).approve(qAddr, Nredeem);
    await q.connect(user).requestRedeem(Nredeem); // id 1

    // --- id 3 (closed): a create that we cancel before cutoff ---
    const cashCancel = 10n * 10n ** 6n;
    await usdc.mint(user.address, cashCancel);
    await usdc.connect(user).approve(qAddr, cashCancel);
    await q.connect(user).requestCreate(cashCancel); // id 2
    await q.connect(user).cancel(2n);                // id 2 -> status 2 (cancelled)

    // Jump past the cutoff for ids 0,1,2 (cutoffDelay default 1h).
    await time.increase(3600 + 1);

    // --- id 3: a pre-cutoff create requested AFTER the jump (cutoff in the future) ---
    const cashPre = 20n * 10n ** 6n;
    await usdc.mint(user.address, cashPre);
    await usdc.connect(user).approve(qAddr, cashPre);
    await q.connect(user).requestCreate(cashPre); // id 3, cutoff in the future

    // Fund the AP for the create (id 0) and the redeem (id 1).
    const Filler = await ethers.getContractFactory("MockAPFiller");
    const ap = await Filler.deploy(await usdc.getAddress());
    const apAddr = await ap.getAddress();
    await c0.mint(apAddr, amtA);
    await c1.mint(apAddr, amtB);
    await ap.approveConstituent(await c0.getAddress(), qAddr, amtA);
    await ap.approveConstituent(await c1.getAddress(), qAddr, amtB);
    await usdc.mint(apAddr, cashOut);

    await ctx.reseedObs();

    const userSharesBefore = await vault.balanceOf(user.address); // = Nredeem (escrowed away) ... actually 0 left
    const userUsdcBefore = await usdc.balanceOf(user.address);
    const qStableBefore = await usdc.balanceOf(qAddr);

    await q.connect(ctx.keeper).settle([0n, 1n, 2n, 3n], tokens, [[], []], apAddr);

    // id 0 (create) settled: user got Ncreate shares; ticket status 1.
    expect((await q.tickets(0n)).status).to.equal(1);
    // id 1 (redeem) settled: user paid cashOut; ticket status 1.
    expect((await q.tickets(1n)).status).to.equal(1);
    expect(await usdc.balanceOf(user.address) - userUsdcBefore).to.equal(cashOut);
    // user share balance: had 0 free (Nredeem was escrowed), now +Ncreate from the create leg.
    expect(await vault.balanceOf(user.address)).to.equal(userSharesBefore + Ncreate);

    // id 2 (cancelled) skipped: still status 2, no double-spend.
    expect((await q.tickets(2n)).status).to.equal(2);

    // id 3 (pre-cutoff) skipped: still status 0, its escrowed cash still sits in the queue (untouched).
    expect((await q.tickets(3n)).status).to.equal(0);
    expect(await usdc.balanceOf(qAddr)).to.equal(cashPre); // only id 3's escrow remains in the queue
    expect(qStableBefore).to.equal(cash + cashPre); // before settle the queue held id0 + id3 cash
  });

  // Regression: create wei-exactness with a NON-ZERO management fee and a time-jump. previewCreate(N)
  // (quoted against post-accrue supply) must equal exactly what create(N) pulls, so the queue holds
  // 0 constituents AND 0 dangling vault allowance after settle (no same-block pendingMintShares drift).
  it("create wei-exact under managerFeeBps>0 + time-jump: no leftover constituents or dangling allowance", async () => {
    // Custom deploy with a non-zero management fee.
    const ctx = await baseDeploy();
    const { c0, c1, seeder, vault, vaultAddr, obs, manager, meridian, treasury, km } = ctx;
    // Re-init is impossible (initializer), so build a fresh fee-bearing vault here.
    const tokens = ctx.tokens;
    const unitQty = [2n * ONE, 3n * ONE];
    const unitSize = ONE;
    const Impl = await ethers.getContractFactory("ManagedRebalanceVault");
    const impl = await Impl.deploy();
    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]", "uint256"], [tokens, unitQty, unitSize])
    );
    const args = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [unitSize, commitment]);
    const Helper = await ethers.getContractFactory("CloneWithArgsHelper");
    const helper = await Helper.deploy();
    await helper.clone(await impl.getAddress(), args);
    const fvault = await ethers.getContractAt("ManagedRebalanceVault", await helper.lastClone());
    const fvaultAddr = await fvault.getAddress();
    await fvault.initializeRebalance(tokens, unitQty, "RB", "RB", {
      manager: manager.address, meridian: meridian.address, treasury: treasury.address,
      managerFeeBps: 100, platformFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress(),
    feeToken: ethers.ZeroAddress, flatCreateFee: 0n, flatRedeemFee: 0n,
    });

    // Bootstrap the fee vault.
    await c0.mint(seeder.address, 2n * ONE); await c0.connect(seeder).approve(fvaultAddr, 2n * ONE);
    await c1.mint(seeder.address, 3n * ONE); await c1.connect(seeder).approve(fvaultAddr, 3n * ONE);
    await fvault.connect(seeder).create(ONE);

    // A queue + gate wired to the FEE vault (mirror baseDeploy wiring).
    const Nav = await ethers.getContractFactory("MockHoldingsNav");
    const nav = await Nav.deploy(); await nav.setNav(NAV_SCALAR);
    const Obs = await ethers.getContractFactory("BasketNavObserver");
    const fobs = await Obs.deploy(await nav.getAddress());
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
      fvaultAddr, await usdc.getAddress(), await nav.getAddress(), await fobs.getAddress(),
      await km.getAddress(), await router.getAddress(), await peg.getAddress(), ctx.deployer.address,
    );
    const qAddr = await q.getAddress();
    await q.setGateParams(2, 600, 200, 200, 3600);
    await q.setG1Refs(await agg.getAddress(), L2_SOURCE);
    for (const t of tokens) { await router.setFeed(t, FEED_ID); await agg.addSource(t, L2_SOURCE); }
    await km.setExecutor(qAddr, true);
    await q.setKeeperTip(0);

    // Seed the observer against the fee vault.
    const t0 = (await time.latest()) + 1;
    await time.setNextBlockTimestamp(t0); await fobs.record(fvaultAddr, [], []);
    await time.setNextBlockTimestamp(t0 + 100); await fobs.record(fvaultAddr, [], []);
    await time.setNextBlockTimestamp(t0 + 200); await fobs.record(fvaultAddr, [], []);

    // user create request.
    const cash = 100n * 10n ** 6n;
    await usdc.mint(ctx.user.address, cash);
    await usdc.connect(ctx.user).approve(qAddr, cash);
    await q.connect(ctx.user).requestCreate(cash);

    // Time-jump so a fee accrues (raises supply at settle); previewCreate must still match create.
    await time.increase(3600 + 1);

    // Re-seed gate freshness for the fee vault + peg.
    const now = await time.latest();
    await time.setNextBlockTimestamp(now + 1); await fobs.record(fvaultAddr, [], []);
    await time.setNextBlockTimestamp(now + 51); await fobs.record(fvaultAddr, [], []);
    await time.setNextBlockTimestamp(now + 101); await fobs.record(fvaultAddr, [], []);
    await peg.setUpdatedAt(await time.latest());

    // The queue derives N from navPerShare at settle; quote previewCreate(N) and fund the AP exactly.
    const navPerShare = await q.settleGateView.staticCall(tokens, [[], []]);
    const N = (cash * ONE) / navPerShare; // spread 0
    const [pTok, pAmt] = await fvault.previewCreate(N);
    const Filler = await ethers.getContractFactory("MockAPFiller");
    const ap = await Filler.deploy(await usdc.getAddress());
    const apAddr = await ap.getAddress();
    for (let i = 0; i < pTok.length; i++) {
      const tok = await ethers.getContractAt("MockERC20Decimals", pTok[i]);
      await tok.mint(apAddr, pAmt[i]);
      await ap.approveConstituent(pTok[i], qAddr, pAmt[i]);
    }

    await q.connect(ctx.keeper).settle([0n], tokens, [[], []], apAddr);

    // user got exactly N shares.
    expect(await fvault.balanceOf(ctx.user.address)).to.equal(N);
    // No leftover constituents and no dangling vault allowance from the queue.
    for (let i = 0; i < pTok.length; i++) {
      const tok = await ethers.getContractAt("MockERC20Decimals", pTok[i]);
      expect(await tok.balanceOf(qAddr)).to.equal(0n);
      expect(await tok.allowance(qAddr, fvaultAddr)).to.equal(0n);
    }
  });
});
