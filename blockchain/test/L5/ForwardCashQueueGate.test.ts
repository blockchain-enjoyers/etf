import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

// g0-g8 settle gate for ForwardCashQueue. The gate reads heldTokens()/totalSupply() from the VAULT
// (MockGateVault), NAV from MockHoldingsNav, TWAP from a BasketNavObserver seeded against the vault,
// feed coverage from MockFeedRouter (g1), L2-source coverage from MockAggregator (g1), and the peg
// from MockPegFeed (g8). settleGateView(held, payloads) is the view wrapper around the gate.

const FEED_ID = "0x" + "11".repeat(32); // non-zero bytes32 feed id
const L2_SOURCE = "0x000000000000000000000000000000000000beef"; // non-zero l2 router source placeholder

async function deploy() {
  const [owner] = await ethers.getSigners();

  // HELD token (just needs an address).
  const HELD = ethers.Wallet.createRandom().address;

  // Vault: totalSupply 2e18, held = [HELD].
  const Vault = await ethers.getContractFactory("MockGateVault");
  const vault = await Vault.deploy(2n * ONE);
  await vault.setHeld([HELD]);
  const vaultAddr = await vault.getAddress();

  // NAV mock: nav 200e18 -> navPerShare 100e18 with supply 2e18; default Open+safe.
  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy();
  await nav.setNav(200n * ONE);

  // Observer over the nav mock, seeded against the vault address.
  const Obs = await ethers.getContractFactory("BasketNavObserver");
  const obs = await Obs.deploy(await nav.getAddress());

  // g1 refs + g8 peg.
  const Router = await ethers.getContractFactory("MockFeedRouter");
  const router = await Router.deploy();
  const Agg = await ethers.getContractFactory("MockAggregator");
  const agg = await Agg.deploy();
  const Peg = await ethers.getContractFactory("MockPegFeed");
  const peg = await Peg.deploy(1_0000_0000n); // $1.00 at 8 dec

  // Stablecoin (unused by the gate but needed by the constructor).
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const usdc = await Tok.deploy("USDC", "USDC", 6);

  const Q = await ethers.getContractFactory("ForwardCashQueue");
  const q = await Q.deploy(
    vaultAddr,
    await usdc.getAddress(),
    await nav.getAddress(),
    await obs.getAddress(),
    ethers.ZeroAddress, // keeperModule (unused by gate)
    await router.getAddress(),
    await peg.getAddress(),
    owner.address,
  );

  // Gate params: minN=2, window=600, twapBps=2%, pegBps=2%, pegMaxAge=3600.
  await q.setGateParams(2, 600, 200, 200, 3600);
  await q.setG1Refs(await agg.getAddress(), L2_SOURCE);

  // g1 coverage for HELD.
  await router.setFeed(HELD, FEED_ID);
  await agg.addSource(HELD, L2_SOURCE);

  // Seed >= 2 Open+safe observations against the VAULT (consult returns count>=2, twap ~= 100e18).
  const t0 = (await time.latest()) + 1;
  await time.setNextBlockTimestamp(t0);
  await obs.record(vaultAddr, [], []); // seed (discarded)
  await time.setNextBlockTimestamp(t0 + 100);
  await obs.record(vaultAddr, [], []); // interval weighted by 100
  await time.setNextBlockTimestamp(t0 + 200);
  await obs.record(vaultAddr, [], []); // interval weighted by 100 -> twap == 100e18

  return { owner, q, vault, nav, obs, router, agg, peg, usdc, vaultAddr, HELD };
}

describe("ForwardCashQueue — g0-g8 settle gate", () => {
  it("happy path: Open+safe+covered+fresh-TWAP+pegged returns navPerShare == 100e18", async () => {
    const { q, HELD } = await loadFixture(deploy);
    expect(await q.settleGateView([HELD], [[]])).to.equal(100n * ONE);
  });

  it("g2 NotOpen: marketStatus != 0 reverts NotOpen", async () => {
    const { q, nav, HELD } = await loadFixture(deploy);
    await nav.setStatusSafe(3, true); // Closed
    await expect(q.settleGateView([HELD], [[]])).to.be.revertedWithCustomError(q, "NotOpen");
  });

  it("g3 NotSafe: safe == false reverts NotSafe", async () => {
    const { q, nav, HELD } = await loadFixture(deploy);
    await nav.setStatusSafe(0, false); // Open but unsafe
    await expect(q.settleGateView([HELD], [[]])).to.be.revertedWithCustomError(q, "NotSafe");
  });

  it("g1 FeedNotSet: a held token with no router feed reverts FeedNotSet", async () => {
    const { q, vault, HELD } = await loadFixture(deploy);
    const unfunded = ethers.Wallet.createRandom().address;
    await vault.setHeld([unfunded]); // not configured on router/aggregator
    await expect(q.settleGateView([unfunded], [[]])).to.be.revertedWithCustomError(q, "FeedNotSet");
  });

  it("g1 L2SourceMissing: a held token with a feed but no aggregator source reverts L2SourceMissing", async () => {
    const { q, vault, router, HELD } = await loadFixture(deploy);
    const covered = ethers.Wallet.createRandom().address;
    await vault.setHeld([covered]);
    await router.setFeed(covered, FEED_ID); // feed set, but NOT registered as an aggregator source
    await expect(q.settleGateView([covered], [[]])).to.be.revertedWithCustomError(q, "L2SourceMissing");
  });

  it("HeldMismatch: a settleGateView held array != vault.heldTokens() reverts HeldMismatch", async () => {
    const { q, HELD } = await loadFixture(deploy);
    // wrong length (empty)
    await expect(q.settleGateView([], [])).to.be.revertedWithCustomError(q, "HeldMismatch");
    // right length, wrong element
    const wrong = ethers.Wallet.createRandom().address;
    await expect(q.settleGateView([wrong], [[]])).to.be.revertedWithCustomError(q, "HeldMismatch");
  });

  it("g8 PegBreached: peg at $0.90 reverts PegBreached", async () => {
    const { q, peg, HELD } = await loadFixture(deploy);
    await peg.setPrice(9000_0000n); // $0.90 at 8 dec
    await expect(q.settleGateView([HELD], [[]])).to.be.revertedWithCustomError(q, "PegBreached");
  });

  it("g7 TwapBandBreached: struck navPerShare diverges from the in-window TWAP by > twapBandBps", async () => {
    const { q, nav, HELD } = await loadFixture(deploy);
    // The observer's in-window TWAP was recorded entirely at nav 200e18 (navPerShare 100e18). Move the
    // nav to 220e18 ONLY now (no new record), so the struck navPerShare = 110e18 is 10% above the stale
    // TWAP (~100e18) — far beyond the 2% (twapBandBps=200) band. Recording after this change would pull
    // the TWAP back into band, so we deliberately do NOT record.
    await nav.setNav(220n * ONE); // navPerShare 110e18 vs TWAP ~100e18 => 10% > 2%
    await expect(q.settleGateView([HELD], [[]])).to.be.revertedWithCustomError(q, "TwapBandBreached");
  });

  it("g8 PegStale: updatedAt older than pegMaxAge reverts PegStale", async () => {
    const { q, peg, HELD } = await loadFixture(deploy);
    const now = await time.latest();
    await peg.setUpdatedAt(now - (3600 + 100)); // pegMaxAge=3600; 3700s old => stale
    await expect(q.settleGateView([HELD], [[]])).to.be.revertedWithCustomError(q, "PegStale");
  });

  it("g8 future updatedAt: updatedAt ahead of now reverts (block.timestamp - updatedAt underflows)", async () => {
    const { q, peg, HELD } = await loadFixture(deploy);
    const now = await time.latest();
    await peg.setUpdatedAt(now + 1_000_000); // future timestamp => subtraction underflows
    // The exact selector is an arithmetic Panic (0x11), so assert a plain revert.
    await expect(q.settleGateView([HELD], [[]])).to.be.reverted;
  });

  it("g0 supply==0: zero totalSupply reverts VaultNotBootstrapped (named, not raw Panic)", async () => {
    const { q, vault, HELD } = await loadFixture(deploy);
    await vault.setSupply(0);
    await expect(q.settleGateView([HELD], [[]])).to.be.revertedWithCustomError(q, "VaultNotBootstrapped");
  });

  it("g6 InsufficientPrints: a fresh observer/vault with <2 in-window prints fails closed (NoObservations)", async () => {
    // Build a context whose observer has been seeded against a DIFFERENT vault, so consult on this
    // queue's vault has 0 observations -> the observer reverts NoObservations (the fail-closed g6 path).
    const [owner] = await ethers.getSigners();
    const HELD = ethers.Wallet.createRandom().address;
    const Vault = await ethers.getContractFactory("MockGateVault");
    const vault = await Vault.deploy(2n * ONE);
    await vault.setHeld([HELD]);
    const Nav = await ethers.getContractFactory("MockHoldingsNav");
    const nav = await Nav.deploy();
    await nav.setNav(200n * ONE);
    const Obs = await ethers.getContractFactory("BasketNavObserver");
    const obs = await Obs.deploy(await nav.getAddress()); // NEVER recorded -> no observations
    const Router = await ethers.getContractFactory("MockFeedRouter");
    const router = await Router.deploy();
    const Agg = await ethers.getContractFactory("MockAggregator");
    const agg = await Agg.deploy();
    const Peg = await ethers.getContractFactory("MockPegFeed");
    const peg = await Peg.deploy(1_0000_0000n);
    const Tok = await ethers.getContractFactory("MockERC20Decimals");
    const usdc = await Tok.deploy("USDC", "USDC", 6);
    const Q = await ethers.getContractFactory("ForwardCashQueue");
    const q = await Q.deploy(
      await vault.getAddress(),
      await usdc.getAddress(),
      await nav.getAddress(),
      await obs.getAddress(),
      ethers.ZeroAddress,
      await router.getAddress(),
      await peg.getAddress(),
      owner.address,
    );
    await q.setGateParams(2, 600, 200, 200, 3600);
    await q.setG1Refs(await agg.getAddress(), L2_SOURCE);
    await router.setFeed(HELD, FEED_ID);
    await agg.addSource(HELD, L2_SOURCE);
    // The observer reverts NoObservations (fewer than 2 observations); this surfaces from settleGateView.
    await expect(q.settleGateView([HELD], [[]])).to.be.revertedWithCustomError(obs, "NoObservations");
  });
});
