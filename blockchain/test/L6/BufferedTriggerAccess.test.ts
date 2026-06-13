import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const NO_PAYLOADS: string[][] = [];
const NO_TOKENS: string[] = [];

// Minimal guard fixture — no real auction needed for access-control + edge tests.
async function deployMinimal() {
  const [owner, keeper, stranger] = await ethers.getSigners();

  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy();
  await nav.setNav(100n * ONE);
  await nav.setBand(98n * ONE, 102n * ONE);
  await nav.setStatusSafe(3, true); // Closed

  const Agg = await ethers.getContractFactory("MockListingAggregator");
  const agg = await Agg.deploy();

  // trigger=500, reset=200, cooldown=1000 (for cooldown tests), minCardinality=1.
  const Mod = await ethers.getContractFactory("RebalanceModule");
  const mod = await Mod.deploy(owner.address, 500, 200, 1000, 1);

  const Seq = await ethers.getContractFactory("SequencerGuard");
  const seq = await Seq.deploy(ethers.ZeroAddress, false);

  const Guard = await ethers.getContractFactory("BufferedTriggerGuard");
  const guard = await Guard.deploy(
    await nav.getAddress(),
    await agg.getAddress(),
    await mod.getAddress(),
    await seq.getAddress(),
    ethers.ZeroAddress // no real auction
  );

  const vault = ethers.Wallet.createRandom().address;
  await guard.setVaultCfg(vault, false, 1900, 0, 0);

  // Dummy leg (auction address is ZeroAddress — these calls revert at auction level,
  // but access-control tests revert before that).
  const leg = {
    release: [] as string[],
    releaseOut: [] as bigint[],
    acquire: [] as string[],
    startIn: [] as bigint[],
    endIn: [] as bigint[],
    duration: 3600n,
  };

  return { guard, nav, vault, owner, keeper, stranger, leg };
}

describe("BufferedTriggerGuard — access control & edge cases", () => {
  // ── Access control ──────────────────────────────────────────────────────────

  it("non-keeper openWeekendRebalance reverts NotKeeper", async () => {
    const { guard, vault, stranger, leg } = await loadFixture(deployMinimal);
    await expect(
      guard.connect(stranger).openWeekendRebalance(vault, leg, NO_TOKENS, NO_PAYLOADS, 600, 3)
    ).to.be.revertedWithCustomError(guard, "NotKeeper");
  });

  it("non-keeper clearLatch reverts NotKeeper", async () => {
    const { guard, vault, stranger } = await loadFixture(deployMinimal);
    await expect(
      guard.connect(stranger).clearLatch(vault, 100)
    ).to.be.revertedWithCustomError(guard, "NotKeeper");
  });

  it("non-owner setVaultCfg reverts NotOwner", async () => {
    const { guard, vault, stranger } = await loadFixture(deployMinimal);
    await expect(
      guard.connect(stranger).setVaultCfg(vault, false, 1900, 0, 0)
    ).to.be.revertedWithCustomError(guard, "NotOwner");
  });

  it("non-owner setKeeper reverts NotOwner", async () => {
    const { guard, stranger, keeper } = await loadFixture(deployMinimal);
    await expect(
      guard.connect(stranger).setKeeper(keeper.address, true)
    ).to.be.revertedWithCustomError(guard, "NotOwner");
  });

  it("owner can grant and revoke keeper role; KeeperSet event is emitted", async () => {
    const { guard, keeper, stranger } = await loadFixture(deployMinimal);
    await expect(guard.setKeeper(keeper.address, true))
      .to.emit(guard, "KeeperSet")
      .withArgs(keeper.address, true);
    expect(await guard.isKeeper(keeper.address)).to.equal(true);

    await guard.setKeeper(keeper.address, false);
    expect(await guard.isKeeper(keeper.address)).to.equal(false);
  });

  // ── nav == 0 → BandTooWide ──────────────────────────────────────────────────

  it("checkTrigger reverts BandTooWide when nav is zero", async () => {
    const { guard, nav, vault } = await loadFixture(deployMinimal);
    await nav.setNav(0n);
    await expect(
      guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 600, 3)
    ).to.be.revertedWithCustomError(guard, "BandTooWide");
  });

  // ── confUpper < confLower → BandTooWide (defensive underflow guard) ─────────

  it("checkTrigger reverts BandTooWide when confUpper < confLower", async () => {
    const { guard, nav, vault } = await loadFixture(deployMinimal);
    // Set confLower > confUpper to trigger the defensive check.
    await nav.setBand(110n * ONE, 90n * ONE); // lower=110, upper=90 (inverted)
    await expect(
      guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 600, 3)
    ).to.be.revertedWithCustomError(guard, "BandTooWide");
  });

  // ── Cooldown ────────────────────────────────────────────────────────────────

  it("first-ever checkTrigger (lastAction==0) passes the cooldown gate — since is huge", async () => {
    // Module: trigger=500, reset=200, cooldown=1000, minCardinality=1.
    // lastAction[vault]=0 → since = block.timestamp (very large) >> cooldown (1000).
    // drift=600 > trigger=500, cardinality=3 >= 1 → should fire.
    const { guard, nav, vault } = await loadFixture(deployMinimal);
    // Need a module that will return true on first call (cooldown won't block since lastAction=0).
    // The fixture already has cooldown=1000 — but since lastAction=0, since=block.timestamp >> 1000.
    expect(await guard.checkTrigger.staticCall(vault, NO_TOKENS, NO_PAYLOADS, 600, 3)).to.equal(true);
  });

  it("cooldown blocks when lastAction is recent (simulate via a guard with very long cooldown)", async () => {
    // Deploy a fresh guard with cooldown = 10^9 seconds (effectively infinite).
    // Since lastAction[vault]=0, block.timestamp < 10^9 would also be a problem —
    // instead we drive lastAction by calling openWeekendRebalance via a real auction OR
    // we use the module directly: evaluate(driftBps, cardinality, latched=false, sinceRebalance)
    // where sinceRebalance < cooldown → returns false.
    //
    // Strategy: deploy a guard with a fresh module whose cooldown > block.timestamp so even
    // the first call (since=block.timestamp) is blocked.
    const [owner2] = await ethers.getSigners();

    const Nav2 = await ethers.getContractFactory("MockHoldingsNav");
    const nav2 = await Nav2.deploy();
    await nav2.setNav(100n * ONE);
    await nav2.setBand(98n * ONE, 102n * ONE);
    await nav2.setStatusSafe(3, true);

    const Agg2 = await ethers.getContractFactory("MockListingAggregator");
    const agg2 = await Agg2.deploy();

    // cooldown = 10^18 (much larger than any realistic block.timestamp ~1.7*10^9)
    // so sinceRebalance (= block.timestamp - 0) < cooldown → NotDue.
    const Mod2 = await ethers.getContractFactory("RebalanceModule");
    const mod2 = await Mod2.deploy(owner2.address, 500, 200, 10n ** 18n, 1);

    const Seq2 = await ethers.getContractFactory("SequencerGuard");
    const seq2 = await Seq2.deploy(ethers.ZeroAddress, false);

    const Guard2 = await ethers.getContractFactory("BufferedTriggerGuard");
    const guard2 = await Guard2.deploy(
      await nav2.getAddress(),
      await agg2.getAddress(),
      await mod2.getAddress(),
      await seq2.getAddress(),
      ethers.ZeroAddress
    );

    const vault2 = ethers.Wallet.createRandom().address;
    await guard2.setVaultCfg(vault2, false, 1900, 0, 0);

    // drift=600 > trigger=500, cardinality=3 >= 1, latched=false, but since < cooldown → NotDue.
    await expect(
      guard2.checkTrigger.staticCall(vault2, NO_TOKENS, NO_PAYLOADS, 600, 3)
    ).to.be.revertedWithCustomError(guard2, "NotDue");
  });
});
