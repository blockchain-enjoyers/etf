import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

// ForwardCashQueue — REGISTRY (500-native) SINGLE-SHOT cash-in/out (Part 3, Tasks 2-4).
//
// Q7 / small-N caveat (plan §E): ~500 INTERNAL claim moves fit one tx, so the settle is single-shot; the
// chunking lives at the AP's one-time `wrap` (Task 5), not the settle. The testnet has only a few stock tokens,
// so TRUE 500 cannot be run on-chain — correctness is validated at N=2; the 500-fits-one-tx claim rests on the
// Q7 internal-gas math.
//
// Arithmetic (wei-exact; managerFeeBps = platformFeeBps = 0):
//   - Registry vault bootstrapped to supply 1e18, holdings 2e18 A / 3e18 B.
//   - MockNav.nav = 1e6 -> navPerShare = nav*1e18/supply = 1e6.
//   - USDG is the 18-dec stable AND the vault feeToken (the feeToken == stable invariant).

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"];
const FEED_ID = "0x" + "11".repeat(32);
const L2_SOURCE = "0x000000000000000000000000000000000000beef";
const NAV_SCALAR = 1_000_000n;

type FixtureOpts = { flatCreateFee?: bigint; flatRedeemFee?: bigint; feeTokenOverride?: "mismatch" };

async function deployRegistry(opts: FixtureOpts = {}) {
  const [deployer, manager, meridian, treasury, user, ap, keeper, seeder] = await ethers.getSigners();

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  let [c0, c1] = [a, b];
  if (BigInt(t0) > BigInt(t1)) { [t0, t1] = [t1, t0]; [c0, c1] = [c1, c0]; }
  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;

  const values = tokens.map((t, i) => [t, unitQty[i].toString(), unitSize.toString()]);
  const tree = StandardMerkleTree.of(values, ENC);
  const proofByToken: Record<string, string[]> = {};
  for (const [i, v] of tree.entries()) proofByToken[v[0]] = tree.getProof(i);
  const proofs = tokens.map((t) => proofByToken[t]);

  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);

  const usdg = await Tok.deploy("USDG", "USDG", 18);
  const usdgAddr = await usdg.getAddress();

  const Bv = await ethers.getContractFactory("BasketVault"); const bImpl = await Bv.deploy();
  const Mv = await ethers.getContractFactory("ManagedVault"); const mImpl = await Mv.deploy();
  const Cv = await ethers.getContractFactory("CommittedVault"); const cImpl = await Cv.deploy();
  const Rrv = await ethers.getContractFactory("RegistryRebalanceVault"); const rrImpl = await Rrv.deploy();
  const F = await ethers.getContractFactory("CloneFactory");
  const f = await F.deploy(await bImpl.getAddress(), await mImpl.getAddress(), await cImpl.getAddress());
  await f.setRegistryRebalanceImpl(await rrImpl.getAddress());
  await f.setConstituentAllowed(t0, true);
  await f.setConstituentAllowed(t1, true);
  await f.setMeridian(meridian.address);
  await f.setTreasury(treasury.address);
  await f.setPlatformFeeBps(0); // exactness: no fee accrual drift

  const otherFeeToken = opts.feeTokenOverride === "mismatch" ? await (await Tok.deploy("X", "X", 18)).getAddress() : usdgAddr;
  await f.setFeeToken(otherFeeToken);
  await f.setDefaultFlatFees(opts.flatCreateFee ?? 0n, opts.flatRedeemFee ?? 0n);

  const idx = {
    genesisRoot: tree.root, tokens, unitSize,
    name: "SP500x", symbol: "SP500x",
    manager: manager.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress(),
  };
  const vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
  await f.createRegistryIndex(idx, ethers.ZeroHash);
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);

  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy(); await nav.setNav(NAV_SCALAR);
  const Obs = await ethers.getContractFactory("BasketNavObserver");
  const obs = await Obs.deploy(await nav.getAddress());
  const Router = await ethers.getContractFactory("MockFeedRouter");
  const router = await Router.deploy();
  const Agg = await ethers.getContractFactory("MockAggregator");
  const agg = await Agg.deploy();
  const Peg = await ethers.getContractFactory("MockPegFeed");
  const peg = await Peg.deploy(1_0000_0000n);

  const Q = await ethers.getContractFactory("ForwardCashQueue");
  let q: any = undefined;
  let qAddr: string = ethers.ZeroAddress;
  if (opts.feeTokenOverride !== "mismatch") {
    q = await Q.deploy(
      vaultAddr, usdgAddr, await nav.getAddress(), await obs.getAddress(),
      await km.getAddress(), await router.getAddress(), await peg.getAddress(), deployer.address,
    );
    qAddr = await q.getAddress();
    await q.setGateParams(2, 600, 200, 200, 3600);
    await q.setG1Refs(await agg.getAddress(), L2_SOURCE);
    for (const t of tokens) { await router.setFeed(t, FEED_ID); await agg.addSource(t, L2_SOURCE); }
    await km.setExecutor(qAddr, true);
    await km.setMaxRewardPerCall(ethers.MaxUint256);
    await q.setKeeperTip(0);
    await vault.connect(meridian).setSettler(qAddr, true); // the queue is the registry vault's settler
  } else {
    for (const t of tokens) { await router.setFeed(t, FEED_ID); await agg.addSource(t, L2_SOURCE); }
  }

  const idOf = (t: string) => BigInt(t);
  const claimBal = (who: string, token: string) => vault["balanceOf(address,uint256)"](who, idOf(token));
  async function wrapFor(who: any, amtByTok: Record<string, bigint>) {
    for (const t of tokens) {
      const amt = amtByTok[t] ?? 0n;
      if (amt === 0n) continue;
      const tok = t === t0 ? c0 : c1;
      await tok.mint(who.address, amt);
      await tok.connect(who).approve(vaultAddr, amt);
      await vault.connect(who).wrap(t, amt);
    }
  }
  async function reseedObs() {
    const now = await time.latest();
    await time.setNextBlockTimestamp(now + 1); await obs.record(vaultAddr, [], []);
    await time.setNextBlockTimestamp(now + 51); await obs.record(vaultAddr, [], []);
    await time.setNextBlockTimestamp(now + 101); await obs.record(vaultAddr, [], []);
    await peg.setUpdatedAt(await time.latest());
  }

  return {
    deployer, manager, meridian, treasury, user, ap, keeper, seeder,
    c0, c1, tokens, t0, t1, unitQty, unitSize, proofs,
    vault, vaultAddr, km, nav, obs, router, agg, peg, usdg, usdgAddr, q, qAddr,
    idOf, claimBal, wrapFor, reseedObs,
  };
}

async function bootstrapped(opts: FixtureOpts = {}) {
  const ctx = await deployRegistry(opts);
  const { ap, vault, vaultAddr, obs, t0, t1, unitQty, tokens, proofs } = ctx;
  await ctx.wrapFor(ap, { [t0]: unitQty[0], [t1]: unitQty[1] });
  await vault.connect(ap).bootstrap(ONE, tokens, unitQty, proofs); // supply 1e18, holdings 2e18/3e18

  const s0 = (await time.latest()) + 1;
  await time.setNextBlockTimestamp(s0); await obs.record(vaultAddr, [], []);
  await time.setNextBlockTimestamp(s0 + 100); await obs.record(vaultAddr, [], []);
  await time.setNextBlockTimestamp(s0 + 200); await obs.record(vaultAddr, [], []);
  return ctx;
}

// Request a create, AP provisions claims + authorizes the queue as operator, jump past cutoff + reseed gate.
async function readyCreate(opts: FixtureOpts = {}, cash = 100n * 10n ** 6n) {
  const ctx = await bootstrapped(opts);
  const { q, qAddr, vault, user, ap, usdg, t0, t1 } = ctx;
  await usdg.mint(user.address, cash);
  await usdg.connect(user).approve(qAddr, cash);
  await q.connect(user).requestCreate(cash);
  const id = 0n;

  await ctx.wrapFor(ap, { [t0]: 200n * ONE, [t1]: 300n * ONE }); // ample for any sub-cap fill
  await vault.connect(ap).setOperator(qAddr, true);

  await time.increase(3600 + 1);
  await ctx.reseedObs();
  return { ...ctx, id, cash };
}

describe("ForwardCashQueue — registry routing (Task 2)", () => {
  it("flags a registry vault and accepts feeToken == stable", async () => {
    const { q } = await deployRegistry();
    expect(await q.isRegistry()).to.equal(true);
  });

  it("reverts FeeTokenMismatch when a registry vault's feeToken != stable", async () => {
    const Q = await ethers.getContractFactory("ForwardCashQueue");
    const ctx = await deployRegistry({ feeTokenOverride: "mismatch" });
    await expect(
      Q.deploy(
        ctx.vaultAddr, ctx.usdgAddr, await ctx.nav.getAddress(), await ctx.obs.getAddress(),
        await ctx.km.getAddress(), await ctx.router.getAddress(), await ctx.peg.getAddress(), ctx.deployer.address,
      )
    ).to.be.revertedWithCustomError(Q, "FeeTokenMismatch");
  });

  it("a managed (non-registry) vault is NOT flagged and skips the feeToken assertion", async () => {
    const [deployer, manager, meridian, treasury] = await ethers.getSigners();
    const Tok = await ethers.getContractFactory("MockERC20Decimals");
    const a = await Tok.deploy("A", "A", 18); const b = await Tok.deploy("B", "B", 18);
    let [t0, t1] = [await a.getAddress(), await b.getAddress()];
    if (BigInt(t0) > BigInt(t1)) [t0, t1] = [t1, t0];
    const tokens = [t0, t1]; const unitQty = [2n * ONE, 3n * ONE]; const unitSize = ONE;
    const Km = await ethers.getContractFactory("KeeperModule"); const km = await Km.deploy(deployer.address);
    const Impl = await ethers.getContractFactory("ManagedRebalanceVault"); const impl = await Impl.deploy();
    const commitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]", "uint256"], [tokens, unitQty, unitSize]));
    const args = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [unitSize, commitment]);
    const Helper = await ethers.getContractFactory("CloneWithArgsHelper"); const helper = await Helper.deploy();
    await helper.clone(await impl.getAddress(), args);
    const vault = await ethers.getContractAt("ManagedRebalanceVault", await helper.lastClone());
    await vault.initializeRebalance(tokens, unitQty, "RB", "RB", {
      manager: manager.address, meridian: meridian.address, treasury: treasury.address,
      managerFeeBps: 0, platformFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress(),
      feeToken: ethers.ZeroAddress, flatCreateFee: 0n, flatRedeemFee: 0n,
    });
    const usdc = await Tok.deploy("USDC", "USDC", 6);
    const Nav = await ethers.getContractFactory("MockHoldingsNav"); const nav = await Nav.deploy();
    const Obs = await ethers.getContractFactory("BasketNavObserver"); const obs = await Obs.deploy(await nav.getAddress());
    const Router = await ethers.getContractFactory("MockFeedRouter"); const router = await Router.deploy();
    const Peg = await ethers.getContractFactory("MockPegFeed"); const peg = await Peg.deploy(1_0000_0000n);
    const Q = await ethers.getContractFactory("ForwardCashQueue");
    const q = await Q.deploy(
      await vault.getAddress(), await usdc.getAddress(), await nav.getAddress(), await obs.getAddress(),
      await km.getAddress(), await router.getAddress(), await peg.getAddress(), deployer.address,
    );
    expect(await q.isRegistry()).to.equal(false);
  });
});

describe("ForwardCashQueue — registry create settle, single-shot (Task 3)", () => {
  it("user gets N shares at the forward NAV; AP keeps the cash; queue holds nothing", async () => {
    const c = await readyCreate();
    const { q, qAddr, vault, id, tokens, keeper, user, ap, treasury, usdg, cash, idOf, t0, t1 } = c;
    const N = 100n * ONE; // 100e6 * 1e18 / 1e6

    await expect(q.connect(keeper).settle([id], tokens, [[], []], ap.address)).to.emit(q, "Settled").withArgs(id);

    expect(await vault.balanceOf(user.address)).to.equal(N);
    expect(await usdg.balanceOf(ap.address)).to.equal(cash);            // AP keeps full cash (fee 0)
    expect(await usdg.balanceOf(treasury.address)).to.equal(0n);
    // NON-CUSTODY: queue holds no USDG, no shares, no claims
    expect(await usdg.balanceOf(qAddr)).to.equal(0n);
    expect(await vault.balanceOf(qAddr)).to.equal(0n);
    expect(await c.claimBal(qAddr, t0)).to.equal(0n);
    expect(await c.claimBal(qAddr, t1)).to.equal(0n);
    // AP's staged claims were pulled into vault custody (200e18 of t0 on top of bootstrap 2e18)
    expect(await c.claimBal(c.vaultAddr, t0)).to.equal(2n * ONE + 200n * ONE);
    expect((await q.tickets(id)).status).to.equal(1);
  });

  it("flatCreateFee: treasury gets the FIXED fee, AP keeps cash - fee, shares computed on cash - fee", async () => {
    const fee = 10n * 10n ** 6n;
    const c = await readyCreate({ flatCreateFee: fee });
    const { q, qAddr, vault, id, tokens, keeper, user, ap, treasury, usdg, cash } = c;
    const N = (cash - fee) * ONE / NAV_SCALAR; // (90e6)*1e18/1e6 = 90e18

    await q.connect(keeper).settle([id], tokens, [[], []], ap.address);

    expect(await vault.balanceOf(user.address)).to.equal(N);
    expect(await usdg.balanceOf(treasury.address)).to.equal(fee);       // FIXED fee -> treasury
    expect(await usdg.balanceOf(ap.address)).to.equal(cash - fee);      // AP keeps the rest (spread)
    expect(await usdg.balanceOf(qAddr)).to.equal(0n);                   // single collection point
  });

  it("a cancel before settle refunds the full escrow", async () => {
    const ctx = await bootstrapped();
    const { q, qAddr, user, usdg } = ctx;
    const cash = 100n * 10n ** 6n;
    await usdg.mint(user.address, cash);
    await usdg.connect(user).approve(qAddr, cash);
    await q.connect(user).requestCreate(cash);
    await q.connect(user).cancel(0n);
    expect(await usdg.balanceOf(user.address)).to.equal(cash);
    expect((await q.tickets(0n)).status).to.equal(2);
  });

  it("over-capacity: partial-fills pro-rata and ROLLS the remainder (still cancelable)", async () => {
    // cash 1e6 -> N_full 1e18 (= 100% of supply); 50% cap -> fill 5e17, roll 5e5.
    const c = await readyCreate({}, 1n * 10n ** 6n);
    const { q, qAddr, vault, id, tokens, keeper, user, ap, usdg } = c;
    await q.setCapacity(5000);

    await expect(q.connect(keeper).settle([id], tokens, [[], []], ap.address)).to.emit(q, "PartialFill");

    expect(await vault.balanceOf(user.address)).to.equal(5n * ONE / 10n); // 5e17 capped fill
    const t = await q.tickets(id);
    expect(t.status).to.equal(0);                                         // pending (rolled)
    expect(t.amount).to.equal(5n * 10n ** 5n);                            // 5e5 remainder still escrowed
    expect(await usdg.balanceOf(qAddr)).to.equal(5n * 10n ** 5n);         // red line #1
    expect(await usdg.balanceOf(ap.address)).to.equal(5n * 10n ** 5n);    // AP got the filled half

    // the rolled remainder is fully refundable
    await q.connect(user).cancel(id);
    expect(await usdg.balanceOf(qAddr)).to.equal(0n);
  });

  it("keeper tip on settle is paid from the share escrow and clamped", async () => {
    const c = await readyCreate();
    const { q, vault, km, id, tokens, keeper, ap } = c;
    const escrow = 100n, tip = 50n, cap = 30n;
    await vault.connect(ap).transfer(await km.getAddress(), escrow);
    await q.setKeeperTip(tip);
    await km.setMaxRewardPerCall(cap);

    const before = await vault.balanceOf(keeper.address);
    await q.connect(keeper).settle([id], tokens, [[], []], ap.address);
    expect(await vault.balanceOf(keeper.address) - before).to.equal(30n); // min(50,100,30)
  });
});

describe("ForwardCashQueue — registry cash-redeem flat fee (Task 4)", () => {
  async function redeemSetup(fee: bigint) {
    const ctx = await bootstrapped({ flatRedeemFee: fee });
    const { q, qAddr, vault, user, ap, usdg } = ctx;
    const N = ONE / 2n;
    const cashOut = (N * NAV_SCALAR) / ONE; // 5e5

    await vault.connect(ap).transfer(user.address, N);
    await vault.connect(user).approve(qAddr, N);
    await q.connect(user).requestRedeem(N);

    const Filler = await ethers.getContractFactory("MockAPFiller");
    const apc = await Filler.deploy(await usdg.getAddress());
    const apcAddr = await apc.getAddress();
    await usdg.mint(apcAddr, cashOut);

    await time.increase(3600 + 1);
    await ctx.reseedObs();
    return { ...ctx, N, cashOut, apc, apcAddr };
  }

  it("payout = gross USDG - flatRedeemFee; treasury receives the fixed fee", async () => {
    const fee = 1n * 10n ** 5n;
    const c = await redeemSetup(fee);
    const { q, keeper, tokens, apcAddr, user, treasury, usdg, cashOut, idOf, t0, vault } = c;
    await q.connect(keeper).settle([0n], tokens, [[], []], apcAddr);
    expect(await usdg.balanceOf(user.address)).to.equal(cashOut - fee);
    expect(await usdg.balanceOf(treasury.address)).to.equal(fee);
    expect(await usdg.balanceOf(await q.getAddress())).to.equal(0n);
    expect(await vault["balanceOf(address,uint256)"](apcAddr, idOf(t0))).to.be.greaterThan(0n); // AP got CLAIMS
  });

  it("flatRedeemFee = 0: payout is the full gross, treasury unchanged", async () => {
    const c = await redeemSetup(0n);
    const { q, keeper, tokens, apcAddr, user, treasury, usdg, cashOut } = c;
    await q.connect(keeper).settle([0n], tokens, [[], []], apcAddr);
    expect(await usdg.balanceOf(user.address)).to.equal(cashOut);
    expect(await usdg.balanceOf(treasury.address)).to.equal(0n);
  });

  it("in-kind redeem on the vault pulls NO USDG (the redeem fee is the cash path only)", async () => {
    const fee = 1n * 10n ** 5n;
    const ctx = await bootstrapped({ flatRedeemFee: fee });
    const { vault, ap, usdg, treasury } = ctx;
    const tBefore = await usdg.balanceOf(treasury.address);
    const apBefore = await usdg.balanceOf(ap.address);
    await vault.connect(ap).redeem(ONE / 10n);
    expect(await usdg.balanceOf(treasury.address)).to.equal(tBefore);
    expect(await usdg.balanceOf(ap.address)).to.equal(apBefore);
  });
});
