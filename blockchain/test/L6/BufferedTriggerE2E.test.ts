import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// Full-stand L6 integration: a REAL L4 oracle (PriceAggregator + FairValueNAV + 2 live MockSources per
// constituent, so band/safe/marketStatus are actually computed) drives the BufferedTriggerGuard, which gates
// and opens a REAL L3 RebalanceAuction against a REAL bootstrapped ManagedRebalanceVault; an arbitrageur then
// bids and the vault settles the rebalance at the auction clearing price (never the estimate — iron rule).

const ONE = 10n ** 18n;
const EMPTY = "0x";
const AMM_TWAP = 1; // SourceKind.AMM_TWAP
const ALLOWLIST = 1; // RebalanceAuction.ExecMode.ALLOWLIST
const DEEP = 10_000_000n * ONE; // >> dMin (100_000 ether) -> no depth penalty
const PRICE = 100n * ONE;

async function deploy() {
  const [deployer, manager, meridian, treasury, keeper, bidder] = await ethers.getSigners();

  // --- constituents: A, B held by the vault; C is the external token the bidder brings in ---
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  const c = await Tok.deploy("C", "C", 18);
  const pairs = [
    [await a.getAddress(), a],
    [await b.getAddress(), b],
  ].sort((x, y) => (BigInt(x[0] as string) < BigInt(y[0] as string) ? -1 : 1));
  const tokens = pairs.map((p) => p[0] as string);
  const unitQty = [10n * ONE, 10n * ONE];
  const unitSize = ONE;
  const cAddr = await c.getAddress();
  const [tA, tB] = tokens;
  const cA = pairs.find((p) => p[0] === tA)![1] as any;

  // --- L3: keeper module + bootstrapped ManagedRebalanceVault (holds 10 A + 10 B) ---
  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);
  const Impl = await ethers.getContractFactory("ManagedRebalanceVault");
  const impl = await Impl.deploy();
  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]", "uint256"], [tokens, unitQty, unitSize]),
  );
  const argz = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [unitSize, commitment]);
  const Helper = await ethers.getContractFactory("CloneWithArgsHelper");
  const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), argz);
  const vault = await ethers.getContractAt("ManagedRebalanceVault", await helper.lastClone());
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
  const cB = pairs.find((p) => p[0] === tB)![1] as any;
  await cB.mint(deployer.address, 10n * ONE);
  await cA.approve(await vault.getAddress(), 10n * ONE);
  await cB.approve(await vault.getAddress(), 10n * ONE);
  await vault.create(ONE);
  // Accrue a year of fees so the keeper escrow holds shares to pay the bounded tip from.
  await time.increase(365 * 24 * 3600);
  await vault.accrueFee();

  // --- L3: the Dutch auction (the executor that actually settles) ---
  const Auc = await ethers.getContractFactory("RebalanceAuction");
  const auc = await Auc.deploy(await km.getAddress(), 5n * 10n ** 15n); // maxTip 0.005 share
  await vault.connect(meridian).setExecutor(await auc.getAddress(), true);
  await km.connect(deployer).setExecutor(await auc.getAddress(), true);
  await km.connect(deployer).setMaxRewardPerCall(ONE);

  // --- L4: the REAL oracle. Two live weekend-aware MockSources per held token. ---
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(deployer.address);
  const Mock = await ethers.getContractFactory("MockSource");
  const now = BigInt(await time.latest());
  const srcs: any[] = [];
  for (const t of tokens) {
    for (let i = 0; i < 2; i++) {
      const m = await Mock.deploy();
      // price, depth, lastUpdate, kind, confidence, weekendAware=true, healthy=true
      await m.set(PRICE, DEEP, now, AMM_TWAP, 0n, true, true);
      await agg.addSource(t, await m.getAddress());
      srcs.push(m);
    }
  }
  const Nav = await ethers.getContractFactory("FairValueNAV");
  const nav = await Nav.deploy(await agg.getAddress());

  // --- L6: the guard, wired to the REAL nav/aggregator/module/auction ---
  const Mod = await ethers.getContractFactory("RebalanceModule");
  const mod = await Mod.deploy(deployer.address, 1, 0, 0, 1); // any drift>1 with cardinality>=1 is due
  const Seq = await ethers.getContractFactory("SequencerGuard");
  const seq = await Seq.deploy(ethers.ZeroAddress, false); // disabled (testnet has no feed)
  const Guard = await ethers.getContractFactory("BufferedTriggerGuard");
  const guard = await Guard.deploy(
    await nav.getAddress(),
    await agg.getAddress(),
    await mod.getAddress(),
    await seq.getAddress(),
    await auc.getAddress(),
  );
  const share = await vault.getAddress();
  await guard.setVaultCfg(share, false, 1900, 0, 0); // weekend247=false, eMax 19%, minDepth 0, grace 0
  await guard.setKeeper(keeper.address, true);
  // The guard must be an ALLOWLIST opener on the auction (manager action).
  await auc.connect(manager).setExecMode(share, ALLOWLIST);
  await auc.connect(manager).setOpenAllow(share, await guard.getAddress(), true);

  const held = Array.from(await vault.heldTokens()); // plain array (heldTokens() returns a read-only Result)
  const payloads = held.map(() => [EMPTY, EMPTY]); // 2 sources per token
  const leg = {
    release: [tA],
    releaseOut: [4n * ONE],
    acquire: [cAddr],
    startIn: [5n * ONE],
    endIn: [4n * ONE],
    duration: 100,
  };

  return { guard, vault, auc, km, agg, srcs, share, held, payloads, leg, keeper, bidder, manager, cA, c, tA };
}

describe("BufferedTriggerGuard — full-stand e2e (real oracle -> gate -> auction -> settle)", () => {
  it("opens a weekend rebalance off the real NAV, a bidder settles it, holdings move + keeper is paid", async () => {
    const { guard, vault, auc, km, share, held, payloads, leg, keeper, bidder, cA, c } = await loadFixture(deploy);

    // Sanity: the REAL aggregate sees a tight, weekend-Closed, safe basket NAV (drives the gate).
    // (No assertion needed beyond the open succeeding — the gate would revert otherwise.)
    const escrowBefore = await km.escrowOf(share);
    const navHoldA = await vault.holdingsOf(await cA.getAddress());
    expect(navHoldA).to.equal(10n * ONE); // vault holds 10 A before the rebalance

    // Keeper triggers the gated weekend open against the real auction.
    await guard.connect(keeper).openWeekendRebalance(share, leg, held, payloads, 600, 3);
    expect(await guard.latched(share)).to.equal(true);

    // An arbitrageur fills the delta: brings 5 C, receives 4 A; the vault settles at the clearing price.
    await c.mint(bidder.address, 5n * ONE);
    await c.connect(bidder).approve(await auc.getAddress(), 5n * ONE);
    await auc.connect(bidder).bid(share);

    // Holdings actually moved: A 10 -> 6, and the vault now holds the acquired C.
    expect(await cA.balanceOf(share)).to.equal(6n * ONE);
    expect(await c.balanceOf(share)).to.be.greaterThanOrEqual(4n * ONE);
    // Keeper was paid a bounded tip from the fee escrow (never a flow cut).
    expect(await km.escrowOf(share)).to.be.lessThan(escrowBefore);
  });

  it("real oracle degrades (thin depth -> wide band): the guard blocks before opening", async () => {
    const { guard, srcs, share, held, payloads, leg, keeper, auc } = await loadFixture(deploy);
    // Drive the REAL aggregator into a blown-out band: starve every source of depth.
    for (const m of srcs) await m.setDepth(1n);
    await expect(
      guard.connect(keeper).openWeekendRebalance(share, leg, held, payloads, 600, 3),
    ).to.be.revertedWithCustomError(guard, "BandTooWide");
    expect(await guard.latched(share)).to.equal(false);
    // No auction was created, so a bid finds nothing.
    await expect(auc.connect(keeper).bid(share)).to.be.revertedWithCustomError(auc, "NoActiveAuction");
  });

  it("a weekday source survives on every constituent (real marketStatus Open): the guard blocks (not opted into 24/7)", async () => {
    const { guard, srcs, share, held, payloads, leg, keeper } = await loadFixture(deploy);
    // One live non-weekendAware source per token -> each asset prices Open -> basket Open.
    // srcs layout: [tA_s1, tA_s2, tB_s1, tB_s2]; flip one per token.
    await srcs[0].setWeekendAware(false);
    await srcs[2].setWeekendAware(false);
    await expect(
      guard.connect(keeper).openWeekendRebalance(share, leg, held, payloads, 600, 3),
    ).to.be.revertedWithCustomError(guard, "MarketNotEligible");
    expect(await guard.latched(share)).to.equal(false);
  });
});
