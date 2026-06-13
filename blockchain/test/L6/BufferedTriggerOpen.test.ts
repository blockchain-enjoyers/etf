import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const NO_PAYLOADS: string[][] = [];
const NO_TOKENS: string[] = [];

// Reproduces the L3 wiring from test/L3/RebalanceAuction.test.ts, then adds L6 guard on top.
// RebalanceModule: trigger=1, reset=0, cooldown=0, minCardinality=1 → always due when unlatched.
async function deploy() {
  const [deployer, manager, meridian, treasury, keeper, bidder] = await ethers.getSigners();

  // ── Two constituent ERC20s ───────────────────────────────────────────────────
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const rawA = await Tok.deploy("A", "A", 18);
  const rawB = await Tok.deploy("B", "B", 18);

  // Sort tokens by address (same ordering the L3 test uses)
  let pairs: [string, typeof rawA][] = [
    [await rawA.getAddress(), rawA],
    [await rawB.getAddress(), rawB],
  ].sort((x, y) => (BigInt(x[0]) < BigInt(y[0]) ? -1 : 1)) as [string, typeof rawA][];

  const tokens = pairs.map((p) => p[0]);
  const [tA, tB] = tokens;
  const cA = pairs.find((p) => p[0] === tA)![1];
  const cB = pairs.find((p) => p[0] === tB)![1];

  const unitQty = [10n * ONE, 10n * ONE];
  const unitSize = ONE;

  // ── KeeperModule ─────────────────────────────────────────────────────────────
  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);

  // ── ManagedRebalanceVault via CloneWithArgsHelper ─────────────────────────────
  const Impl = await ethers.getContractFactory("ManagedRebalanceVault");
  const impl = await Impl.deploy();

  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "uint256[]", "uint256"],
      [tokens, unitQty, unitSize]
    )
  );
  const argz = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes32"],
    [unitSize, commitment]
  );

  const Helper = await ethers.getContractFactory("CloneWithArgsHelper");
  const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), argz);
  const vault = await ethers.getContractAt(
    "ManagedRebalanceVault",
    await helper.lastClone()
  );

  await vault.initializeRebalance(tokens, unitQty, "RB", "RB", {
    manager: manager.address,
    meridian: meridian.address,
    treasury: treasury.address,
    managerFeeBps: 200,
    platformFeeBps: 15,
    keeperBps: 250,
    keeperEscrow: await km.getAddress(),
    feeToken: ethers.ZeroAddress,
    flatCreateFee: 0n,
    flatRedeemFee: 0n,
  });

  // Bootstrap the vault: mint tokens to deployer, approve, create 1 share so the vault
  // actually HOLDS the constituent tokens (auction.open reads balanceOf(vault)).
  await cA.mint(deployer.address, 10n * ONE);
  await cB.mint(deployer.address, 10n * ONE);
  await cA.approve(await vault.getAddress(), 10n * ONE);
  await cB.approve(await vault.getAddress(), 10n * ONE);
  await vault.create(ONE);

  // Accrue fees (mirrors L3 test)
  await time.increase(365 * 24 * 3600);
  await vault.accrueFee();

  // ── RebalanceAuction ──────────────────────────────────────────────────────────
  const Auc = await ethers.getContractFactory("RebalanceAuction");
  const auc = await Auc.deploy(await km.getAddress(), 5n * 10n ** 15n); // maxTip 0.005

  // Wire the auction: vault must accept it as executor, keeper module must accept it too
  await vault.connect(meridian).setExecutor(await auc.getAddress(), true);
  await km.connect(deployer).setExecutor(await auc.getAddress(), true);
  await km.connect(deployer).setMaxRewardPerCall(ONE);

  // ── L6 components ────────────────────────────────────────────────────────────
  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy();
  await nav.setNav(100n * ONE);
  await nav.setBand(98n * ONE, 102n * ONE); // 200 bps well within 1900 bps budget
  await nav.setStatusSafe(3, true); // marketStatus=Closed, safe=true

  const Agg = await ethers.getContractFactory("MockListingAggregator");
  const agg = await Agg.deploy();

  // RebalanceModule: trigger 1 bps, reset 0, cooldown 0, minCardinality 1 → always due
  const Mod = await ethers.getContractFactory("RebalanceModule");
  const mod = await Mod.deploy(deployer.address, 1, 0, 0, 1);

  // SequencerGuard: disabled (explicit governance choice: zero feed + required=false)
  const Seq = await ethers.getContractFactory("SequencerGuard");
  const seq = await Seq.deploy(ethers.ZeroAddress, false);

  const Guard = await ethers.getContractFactory("BufferedTriggerGuard");
  const guard = await Guard.deploy(
    await nav.getAddress(),
    await agg.getAddress(),
    await mod.getAddress(),
    await seq.getAddress(),
    await auc.getAddress()
  );

  const vaultAddr = await vault.getAddress();

  // Configure guard for this vault: weekend247=false, eMaxBps=1900, minDepth=0, grace=0
  await guard.setVaultCfg(vaultAddr, false, 1900, 0, 0);

  // Register deployer as keeper so openWeekendRebalance and clearLatch can be called.
  await guard.setKeeper(deployer.address, true);

  // Allow the guard to open auctions on this vault (ALLOWLIST mode)
  // Manager sets execMode=ALLOWLIST and allows the guard
  await auc.connect(manager).setExecMode(vaultAddr, 1); // 1 == ALLOWLIST
  await auc.connect(manager).setOpenAllow(vaultAddr, await guard.getAddress(), true);

  return {
    guard,
    nav,
    auc,
    vault,
    vaultAddr,
    tokenA: cA,
    tokenB: cB,
    tA,
    tB,
    manager,
    deployer,
  };
}

// Second fixture: same L3 wiring but with a module that has reset=200 so the latch CAN be cleared.
// RebalanceModule: trigger=500, reset=200, cooldown=0, minCardinality=1.
// latchCleared(driftBps) = driftBps < 200 → passing e.g. 100 clears the latch.
async function deployWithReset200() {
  const [deployer, manager, meridian, treasury] = await ethers.getSigners();

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const rawA = await Tok.deploy("A", "A", 18);
  const rawB = await Tok.deploy("B", "B", 18);

  let pairs: [string, typeof rawA][] = [
    [await rawA.getAddress(), rawA],
    [await rawB.getAddress(), rawB],
  ].sort((x, y) => (BigInt(x[0]) < BigInt(y[0]) ? -1 : 1)) as [string, typeof rawA][];

  const tokens = pairs.map((p) => p[0]);
  const [tA, tB] = tokens;
  const cA = pairs.find((p) => p[0] === tA)![1];
  const cB = pairs.find((p) => p[0] === tB)![1];

  const unitQty = [10n * ONE, 10n * ONE];
  const unitSize = ONE;

  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);

  const Impl = await ethers.getContractFactory("ManagedRebalanceVault");
  const impl = await Impl.deploy();

  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "uint256[]", "uint256"],
      [tokens, unitQty, unitSize]
    )
  );
  const argz = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "bytes32"],
    [unitSize, commitment]
  );

  const Helper = await ethers.getContractFactory("CloneWithArgsHelper");
  const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), argz);
  const vault = await ethers.getContractAt(
    "ManagedRebalanceVault",
    await helper.lastClone()
  );

  await vault.initializeRebalance(tokens, unitQty, "RB", "RB", {
    manager: manager.address,
    meridian: meridian.address,
    treasury: treasury.address,
    managerFeeBps: 200,
    platformFeeBps: 15,
    keeperBps: 250,
    keeperEscrow: await km.getAddress(),
    feeToken: ethers.ZeroAddress,
    flatCreateFee: 0n,
    flatRedeemFee: 0n,
  });

  await cA.mint(deployer.address, 10n * ONE);
  await cB.mint(deployer.address, 10n * ONE);
  await cA.approve(await vault.getAddress(), 10n * ONE);
  await cB.approve(await vault.getAddress(), 10n * ONE);
  await vault.create(ONE);

  await time.increase(365 * 24 * 3600);
  await vault.accrueFee();

  const Auc = await ethers.getContractFactory("RebalanceAuction");
  const auc = await Auc.deploy(await km.getAddress(), 5n * 10n ** 15n);

  await vault.connect(meridian).setExecutor(await auc.getAddress(), true);
  await km.connect(deployer).setExecutor(await auc.getAddress(), true);
  await km.connect(deployer).setMaxRewardPerCall(ONE);

  const Nav = await ethers.getContractFactory("MockHoldingsNav");
  const nav = await Nav.deploy();
  await nav.setNav(100n * ONE);
  await nav.setBand(98n * ONE, 102n * ONE);
  await nav.setStatusSafe(3, true);

  const Agg = await ethers.getContractFactory("MockListingAggregator");
  const agg = await Agg.deploy();

  // trigger=500 (5%), reset=200 (2%), cooldown=0, minCardinality=1
  // latchCleared(driftBps) = driftBps < 200
  const Mod = await ethers.getContractFactory("RebalanceModule");
  const mod = await Mod.deploy(deployer.address, 500, 200, 0, 1);

  const Seq = await ethers.getContractFactory("SequencerGuard");
  const seq = await Seq.deploy(ethers.ZeroAddress, false);

  const Guard = await ethers.getContractFactory("BufferedTriggerGuard");
  const guard = await Guard.deploy(
    await nav.getAddress(),
    await agg.getAddress(),
    await mod.getAddress(),
    await seq.getAddress(),
    await auc.getAddress()
  );

  const vaultAddr = await vault.getAddress();
  await guard.setVaultCfg(vaultAddr, false, 1900, 0, 0);
  await guard.setKeeper(deployer.address, true);

  await auc.connect(manager).setExecMode(vaultAddr, 1);
  await auc.connect(manager).setOpenAllow(vaultAddr, await guard.getAddress(), true);

  return { guard, nav, auc, vault, vaultAddr, tokenA: cA, tA, tB, deployer };
}

// Helper: build a standard auction leg (release half of tA balance, acquire tB)
async function buildLeg(tokenA: any, vaultAddr: string, tA: string, tB: string) {
  const vaultBalA = await tokenA.balanceOf(vaultAddr);
  const releaseOut = vaultBalA / 2n;
  return {
    release: [tA],
    releaseOut: [releaseOut],
    acquire: [tB],
    startIn: [2n * ONE],
    endIn: [1n * ONE],
    duration: 3600n,
  };
}

describe("BufferedTriggerGuard — open through the live auction", () => {
  it("opens a weekend rebalance and sets the latch + last-action", async () => {
    const { guard, vaultAddr, vault, tokenA, tokenB, tA, tB } =
      await loadFixture(deploy);

    // The vault holds tA and tB after bootstrapping.
    // Build a leg: release tA, acquire tB.
    // releaseOut must be <= vault's balance of tA (which is ~10 ONE after 1-unit create).
    // startIn >= endIn (valid Dutch decay), duration > 0.
    const vaultBalA = await tokenA.balanceOf(vaultAddr);
    const releaseOut = vaultBalA / 2n; // release half the balance — stays within minOut floor

    const leg = {
      release: [tA],
      releaseOut: [releaseOut],
      acquire: [tB],
      startIn: [2n * ONE], // Dutch start price
      endIn: [1n * ONE], // Dutch end price (startIn >= endIn required)
      duration: 3600n,
    };

    await expect(
      guard.openWeekendRebalance(
        vaultAddr,
        leg,
        NO_TOKENS,
        NO_PAYLOADS,
        5, // driftBps > trigger (1 bps) → is due
        3 // cardinality >= minCardinality (1)
      )
    ).to.emit(guard, "WeekendRebalanceOpened");

    expect(await guard.latched(vaultAddr)).to.equal(true);
    expect(await guard.lastAction(vaultAddr)).to.be.greaterThan(0n);
  });

  it("reverts before opening when a gate fails (wide band) — no auction is created", async () => {
    const { guard, nav, vaultAddr, tA, tB } = await loadFixture(deploy);

    // Widen the band: (130-70)/2 = 30 on nav 100 → 3000 bps > 1900 bps budget → BandTooWide
    await nav.setBand(70n * ONE, 130n * ONE);

    const leg = {
      release: [tA],
      releaseOut: [1n * ONE],
      acquire: [tB],
      startIn: [2n * ONE],
      endIn: [1n * ONE],
      duration: 3600n,
    };

    await expect(
      guard.openWeekendRebalance(
        vaultAddr,
        leg,
        NO_TOKENS,
        NO_PAYLOADS,
        5,
        3
      )
    ).to.be.revertedWithCustomError(guard, "BandTooWide");

    // Guard must NOT have latched since the gate blocked before any auction was opened
    expect(await guard.latched(vaultAddr)).to.equal(false);
  });

  it("latch state machine: second open reverts NotDue; clearLatch below reset unlatches", async () => {
    // Uses deployWithReset200: trigger=500, reset=200, cooldown=0, minCardinality=1.
    // latchCleared(driftBps) = driftBps < 200 → passing 100 clears the latch.
    // drift=600 > trigger=500 → openWeekendRebalance fires.
    const { guard, vaultAddr, tokenA, tA, tB } = await loadFixture(deployWithReset200);
    const leg = await buildLeg(tokenA, vaultAddr, tA, tB);

    // First open: succeeds; vault is now latched.
    await guard.openWeekendRebalance(vaultAddr, leg, NO_TOKENS, NO_PAYLOADS, 600, 3);
    expect(await guard.latched(vaultAddr)).to.equal(true);

    // Second open (immediate): latched=true → module.evaluate returns false → NotDue.
    await expect(
      guard.openWeekendRebalance(vaultAddr, leg, NO_TOKENS, NO_PAYLOADS, 600, 3)
    ).to.be.revertedWithCustomError(guard, "NotDue");

    // clearLatch with drift=100 < reset=200 → latchCleared returns true → latched becomes false.
    await guard.clearLatch(vaultAddr, 100);
    expect(await guard.latched(vaultAddr)).to.equal(false);
  });

  it("clearLatch above reset is a no-op — latched stays true", async () => {
    // Uses deployWithReset200: reset=200; latchCleared(300) = 300 < 200 = false → no-op.
    const { guard, vaultAddr, tokenA, tA, tB } = await loadFixture(deployWithReset200);
    const leg = await buildLeg(tokenA, vaultAddr, tA, tB);

    await guard.openWeekendRebalance(vaultAddr, leg, NO_TOKENS, NO_PAYLOADS, 600, 3);
    expect(await guard.latched(vaultAddr)).to.equal(true);

    // driftBps=300 > reset=200 → latchCleared returns false → latch NOT cleared.
    await guard.clearLatch(vaultAddr, 300);
    expect(await guard.latched(vaultAddr)).to.equal(true);
  });
});
