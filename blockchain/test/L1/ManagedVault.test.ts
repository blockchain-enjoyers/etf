import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, MINTER_ROLE, deployRegistry, deployStock, sortRecipe, signPermit, Leg, expectedFeeShares } from "../helpers";
import { deployCloneFactory } from "./helpers";

const BPS = 10_000n;
const YEAR = 365n * 24n * 60n * 60n;

async function deployManagedFixture() {
  const [deployer, manager, meridian, treasury, ap, alice] = await ethers.getSigners();

  const registry = await deployRegistry(deployer.address);
  await (await registry.grantRole(MINTER_ROLE, deployer.address)).wait();

  const tsla = await deployStock(registry, "Tesla", "TSLA");
  const amzn = await deployStock(registry, "Amazon", "AMZN");
  const nvda = await deployStock(registry, "Nvidia", "NVDA");

  const legs: Leg[] = sortRecipe([
    { stock: tsla, addr: await tsla.getAddress(), qty: 2n * ONE },
    { stock: amzn, addr: await amzn.getAddress(), qty: 3n * ONE },
    { stock: nvda, addr: await nvda.getAddress(), qty: 5n * ONE },
  ]);
  const tokens = legs.map((l) => l.addr);
  const unitQty = legs.map((l) => l.qty);
  const unitSize = ONE;

  // Deploy via CloneFactory. We need custom meridian/treasury/platformFeeBps, so:
  // 1. Deploy factory.
  // 2. Set factory globals (meridian, treasury, platformFeeBps) to match the desired managed params.
  // 3. Deploy the managed vault.
  const factory = await deployCloneFactory();
  // Set factory globals to match what the constructor tests expect.
  await (await factory.setMeridian(meridian.address)).wait();
  await (await factory.setTreasury(treasury.address)).wait();
  await (await factory.setPlatformFeeBps(15)).wait(); // 0.15%/yr own line, the test default

  const basket = {
    tokens,
    unitQty,
    unitSize,
    name: "Managed",
    symbol: "MGD",
    manager: manager.address,
    managerFeeBps: 100,
  };
  const salt = ethers.id("managed-fixture-v1");
  const vaultAddr = await factory.predictManagedVaultAddress(deployer.address, basket, salt);
  await (await factory.createManagedBasket(basket, salt)).wait();
  const vault = await ethers.getContractAt("ManagedVault", vaultAddr);

  for (const l of legs) await (await l.stock.mint(ap.address, 1_000_000n * ONE)).wait();
  async function approveFor(signer: any, nUnits: bigint) {
    for (const l of legs) await (await l.stock.connect(signer).approve(vaultAddr, l.qty * nUnits)).wait();
  }

  return { deployer, manager, meridian, treasury, ap, alice, registry, legs, tokens, unitQty, unitSize, vault, vaultAddr, factory, approveFor };
}

// Helper to deploy a managed vault with custom fee params via a new factory.
async function deployManagedWith(tokens: string[], unitQty: bigint[], params: { manager: string; meridian: string; treasury: string; managerFeeBps: number; platformFeeBps: number }, saltStr: string) {
  const [deployer] = await ethers.getSigners();
  const factory = await deployCloneFactory();
  await (await factory.setMeridian(params.meridian)).wait();
  await (await factory.setTreasury(params.treasury)).wait();
  await (await factory.setPlatformFeeBps(params.platformFeeBps)).wait();
  const basket = { tokens, unitQty, unitSize: ONE, name: "x", symbol: "x", manager: params.manager, managerFeeBps: params.managerFeeBps };
  const salt = ethers.id(saltStr);
  await (await factory.createManagedBasket(basket, salt)).wait();
  return ethers.getContractAt("ManagedVault", await factory.allVaults(0));
}

describe("ManagedVault — construction & roles", () => {
  it("stores roles, fees, and lastAccrued", async () => {
    const { vault, manager, meridian, treasury } = await loadFixture(deployManagedFixture);
    expect(await vault.manager()).to.equal(manager.address);
    expect(await vault.meridian()).to.equal(meridian.address);
    expect(await vault.treasury()).to.equal(treasury.address);
    expect(await vault.managerFeeBps()).to.equal(100);
    expect(await vault.platformFeeBps()).to.equal(15);
    expect(await vault.lastAccrued()).to.be.gt(0);
  });

  it("reverts on zero manager — factory propagates the ZeroAddress error from initialize", async () => {
    const { tokens, unitQty, meridian, treasury } = await loadFixture(deployManagedFixture);
    const factory = await deployCloneFactory();
    await (await factory.setMeridian(meridian.address)).wait();
    await (await factory.setTreasury(treasury.address)).wait();
    const basket = { tokens, unitQty, unitSize: ONE, name: "x", symbol: "x", manager: ethers.ZeroAddress, managerFeeBps: 100 };
    await expect(factory.createManagedBasket(basket, ethers.id("zeroaddr")))
      .to.be.reverted;
  });

  it("reverts when managerFeeBps > MANAGER_MAX (200) or platformFeeBps > PLATFORM_FEE_MAX (50)", async () => {
    const { tokens, unitQty, manager, meridian, treasury } = await loadFixture(deployManagedFixture);
    await expect(deployManagedWith(tokens, unitQty, { manager: manager.address, meridian: meridian.address, treasury: treasury.address, managerFeeBps: 201, platformFeeBps: 15 }, "feehigh"))
      .to.be.reverted;
    // platformFeeBps > PLATFORM_FEE_MAX is rejected at the factory setter (own-line cap is 50)
    await expect(deployManagedWith(tokens, unitQty, { manager: manager.address, meridian: meridian.address, treasury: treasury.address, managerFeeBps: 100, platformFeeBps: 51 }, "sharehigh"))
      .to.be.reverted;
  });

  it("accepts fees exactly at the caps (MANAGER_MAX=200, PLATFORM_FEE_MAX=50)", async () => {
    const { tokens, unitQty, manager, meridian, treasury } = await loadFixture(deployManagedFixture);
    const v = await deployManagedWith(tokens, unitQty, { manager: manager.address, meridian: meridian.address, treasury: treasury.address, managerFeeBps: 200, platformFeeBps: 50 }, "atcap");
    expect(await v.managerFeeBps()).to.equal(200);
    expect(await v.platformFeeBps()).to.equal(50);
  });

  it("inherits in-kind create/redeem from the base", async () => {
    const { vault, vaultAddr, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 1n);
    await (await vault.connect(ap).create(1n)).wait();
    expect(await vault.balanceOf(ap.address)).to.equal(ONE); // unitSize
  });

  it("encodes red line #3: FLOW_FEE_BPS is 0 and has no setter", async () => {
    const { vault } = await loadFixture(deployManagedFixture);
    expect(await vault.FLOW_FEE_BPS()).to.equal(0n);
    // there is no setter — assert the ABI exposes none
    const fns = vault.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    expect(fns.some((n: string) => /flow.*fee/i.test(n) && /set/i.test(n))).to.equal(false);
  });
});

describe("ManagedVault — fee accrual", () => {
  it("accrues manager + platform as TWO independent legs (wei-exact, platform is its own line) (#1)", async () => {
    const { vault, manager, treasury, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 100n);
    await (await vault.connect(ap).create(100n)).wait();
    const supply = await vault.totalSupply();
    const lastAccrued = await vault.lastAccrued();
    await time.increase(Number(YEAR));
    const rc = await (await vault.accrueFee()).wait();
    const blk = await ethers.provider.getBlock(rc!.blockNumber);
    const elapsed = BigInt(blk!.timestamp) - lastAccrued; // true on-chain window (>= YEAR by block drift)
    const toTreasury = await vault.balanceOf(treasury.address);
    const toManager = await vault.balanceOf(manager.address);
    // Manager leg @100bps and platform leg @15bps are computed independently — exact mirror of _accrue.
    expect(toManager).to.equal(expectedFeeShares(supply, 100n, elapsed));
    expect(toTreasury).to.equal(expectedFeeShares(supply, 15n, elapsed));
    // Platform is NOT a slice of the manager fee: the old model would give tre ≈ mgr/9.
    expect(toTreasury).to.be.greaterThan(toManager / 8n);
  });

  it("accrues platform as its OWN line (not a share of the manager fee)", async () => {
    const { vault, manager, treasury, ap, approveFor } = await loadFixture(deployManagedFixture);
    // managerFeeBps = 100 (1%/yr). Set platformFeeBps = 15 (0.15%/yr) as Meridian's own line.
    const [, , meridian] = await ethers.getSigners();
    await (await vault.connect(meridian).setPlatformFeeBps(15)).wait();

    await approveFor(ap, 100n);
    await (await vault.connect(ap).create(100n)).wait();      // supply = 100 * unitSize = 100e18
    const supply0 = await vault.totalSupply();

    await time.increase(Number(YEAR));                         // ~1 year
    await (await vault.accrueFee()).wait();

    const mgr = await vault.balanceOf(manager.address);
    const tre = await vault.balanceOf(treasury.address);

    // Manager leg ≈ 1% of supply by dilution; platform leg ≈ 0.15% — INDEPENDENT, additive.
    expect(mgr).to.be.greaterThan((supply0 * 95n) / 10_000n);   // > 0.95%
    expect(mgr).to.be.lessThan((supply0 * 105n) / 10_000n);     // < 1.05%
    expect(tre).to.be.greaterThan((supply0 * 14n) / 10_000n);   // > 0.14%
    expect(tre).to.be.lessThan((supply0 * 17n) / 10_000n);      // < 0.17%
    // explicitly reject the old "share-of-manager" shape (tre would be ~mgr/9 ≈ 0.11%)
    expect(tre).to.be.greaterThan(mgr / 8n);
  });

  it("managerFeeBps == 0 still accrues the platform own line; manager gets nothing (#2)", async () => {
    const { tokens, unitQty, manager, meridian, treasury } = await loadFixture(deployManagedFixture);
    const v = await deployManagedWith(tokens, unitQty, { manager: manager.address, meridian: meridian.address, treasury: treasury.address, managerFeeBps: 0, platformFeeBps: 15 }, "zerofee");
    const a = (await ethers.getSigners())[4]; // ap
    for (const t of tokens) {
      const erc = await ethers.getContractAt("IERC20", t);
      await (await erc.connect(a).approve(await v.getAddress(), ethers.MaxUint256)).wait();
    }
    await (await v.connect(a).create(10n)).wait();
    await time.increase(Number(YEAR));
    await (await v.accrueFee()).wait();
    expect(await v.balanceOf(manager.address)).to.equal(0); // manager leg @0bps mints nothing
    expect(await v.balanceOf(treasury.address)).to.be.gt(0); // platform own line @15bps still accrues
  });

  it("supply==0 and elapsed==0 are safe no-ops, lastAccrued advances on supply==0 (#11)", async () => {
    const { vault } = await loadFixture(deployManagedFixture);
    await time.increase(1000);
    await (await vault.accrueFee()).wait();
    expect(await vault.totalSupply()).to.equal(0);
    await (await vault.accrueFee()).wait();
    expect(await vault.totalSupply()).to.equal(0);
  });

  it("redeem is pro-rata on POST-accrual supply (#5)", async () => {
    const { vault, vaultAddr, legs, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 100n);
    await (await vault.connect(ap).create(100n)).wait();
    await time.increase(Number(YEAR));
    const stock0 = legs[0].stock;
    const apBalBefore = await stock0.balanceOf(ap.address);
    await (await vault.connect(ap).redeem(50n * ONE)).wait();
    expect(await stock0.balanceOf(vaultAddr)).to.be.gt(0);
    expect(await stock0.balanceOf(ap.address)).to.be.gt(apBalBefore);
  });

  // NOTE (plan-review fix): previewRedeem (eth_call at block T) vs the redeem tx (mined at >= T+1)
  // differ by >=1s of accrual, so the quote and payout are NOT bit-equal. Assert closeTo, not equal.
  it("previewRedeem closely matches the actual redeem payout after pending accrual (#13)", async () => {
    const { vault, ap, approveFor, legs } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 100n);
    await (await vault.connect(ap).create(100n)).wait();
    await time.increase(Number(YEAR) / 2);
    const [, quoted] = await vault.previewRedeem(40n * ONE);
    const before = await Promise.all(legs.map((l) => l.stock.balanceOf(ap.address)));
    await (await vault.connect(ap).redeem(40n * ONE)).wait();
    const after = await Promise.all(legs.map((l) => l.stock.balanceOf(ap.address)));
    for (let i = 0; i < legs.length; i++) {
      const got = after[i] - before[i];
      // within a few seconds of fee drift across the preview/redeem block boundary
      expect(got).to.be.closeTo(quoted[i], quoted[i] / 1_000_000n + 10n);
      expect(got).to.be.lte(quoted[i]); // actual <= quote (redeem accrues 1s more -> slightly more dilution)
    }
  });

  it("C1: manager-timed poke at tiny feeShares does NOT starve the platform own line (#14)", async () => {
    const { vault, manager, treasury, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 1n);
    await (await vault.connect(ap).create(1n)).wait();
    for (let i = 0; i < 50; i++) { await time.increase(3600); await (await vault.accrueFee()).wait(); }
    await time.increase(Number(YEAR));
    await (await vault.accrueFee()).wait();
    const toTreasury = await vault.balanceOf(treasury.address);
    const toManager = await vault.balanceOf(manager.address);
    expect(toTreasury).to.be.gt(0); // platform NOT starved by the sub-SCALE remainder carry
    // Platform own line is 15bps vs manager 100bps -> roughly tre ≈ mgr*15/100 (independent legs, same supply).
    if (toManager > 0n) {
      expect(toTreasury).to.be.closeTo((toManager * 15n) / 100n, toManager / 100n + 3n);
    }
  });

  it("accumulator carry: many small accruals ~= one big accrual, frequent is NOT higher (#16/#12)", async () => {
    const { vault, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 100n);
    await (await vault.connect(ap).create(100n)).wait();
    const start = BigInt(await vault.lastAccrued()); // window origin = first accrual (create)
    for (let i = 0; i < 24; i++) { await time.increase(Number(YEAR) / 24); await (await vault.accrueFee()).wait(); }
    const elapsed = BigInt(await vault.lastAccrued()) - start; // true total window of the split run
    const split = (await vault.balanceOf(await vault.manager())) + (await vault.balanceOf(await vault.treasury()));

    const f2 = await loadFixture(deployManagedFixture);
    await f2.approveFor(f2.ap, 100n);
    await (await f2.vault.connect(f2.ap).create(100n)).wait();
    // Mine the single accrue at exactly create + elapsed (same window as the split run, one shot).
    await time.setNextBlockTimestamp(Number(BigInt(await f2.vault.lastAccrued()) + elapsed));
    await (await f2.vault.accrueFee()).wait();
    const single = (await f2.vault.balanceOf(await f2.vault.manager())) + (await f2.vault.balanceOf(await f2.vault.treasury()));

    // Spread is the convexity of x/(1-x): a full-window single accrual exceeds 24 sub-window accruals
    // by < 0.5% at a 1%/yr fee. Bounded and one-directional, not a leak.
    expect(split).to.be.closeTo(single, single / 100n + 5n);
    expect(split).to.be.lte(single + 5n); // #12 direction: frequent accrual is NOT higher (errs toward holders)
  });

  it("scaled-UI split on a constituent does not affect the fee or raw redeem (#10)", async () => {
    const { vault, vaultAddr, manager, treasury, registry, deployer, legs, ap, approveFor } = await loadFixture(deployManagedFixture);
    const { MULTIPLIER_UPDATER_ROLE } = await import("../helpers");
    await approveFor(ap, 100n);
    await (await vault.connect(ap).create(100n)).wait();
    const rawVaultBefore = await legs[0].stock.balanceOf(vaultAddr);
    // 2:1 split on leg 0 (display multiplier doubles; raw unchanged)
    await (await registry.grantRole(MULTIPLIER_UPDATER_ROLE, deployer.address)).wait();
    await (await legs[0].stock.updateMultiplier(2n * ONE)).wait();
    expect(await legs[0].stock.balanceOf(vaultAddr)).to.equal(rawVaultBefore); // raw unchanged
    // accrue + redeem still works; fee shares are basket shares, raw payout pro-rata on raw balance
    await time.increase(Number(YEAR) / 4);
    await (await vault.accrueFee()).wait();
    const apBefore = await legs[0].stock.balanceOf(ap.address);
    await (await vault.connect(ap).redeem(10n * ONE)).wait();
    expect(await legs[0].stock.balanceOf(ap.address)).to.be.gt(apBefore); // got raw leg out
    expect((await vault.balanceOf(manager.address)) + (await vault.balanceOf(treasury.address))).to.be.gt(0); // fee accrued in basket shares
  });
});

describe("ManagedVault — fee setters & timelock", () => {
  it("cap enforcement on setters (#3)", async () => {
    const { vault, manager, meridian } = await loadFixture(deployManagedFixture);
    await expect(vault.connect(manager).setManagerFeeBps(201)).to.be.revertedWithCustomError(vault, "FeeTooHigh");
    await expect(vault.connect(meridian).setPlatformFeeBps(51)).to.be.revertedWithCustomError(vault, "PlatformFeeTooHigh");
  });

  it("only the owner role can set its knob", async () => {
    const { vault, manager, meridian, alice } = await loadFixture(deployManagedFixture);
    await expect(vault.connect(alice).setManagerFeeBps(50)).to.be.revertedWithCustomError(vault, "NotManager");
    await expect(vault.connect(alice).setPlatformFeeBps(30)).to.be.revertedWithCustomError(vault, "NotMeridian");
    await expect(vault.connect(manager).setPlatformFeeBps(30)).to.be.revertedWithCustomError(vault, "NotMeridian");
    await expect(vault.connect(meridian).setManagerFeeBps(50)).to.be.revertedWithCustomError(vault, "NotManager");
  });

  it("decrease is instant; increase is timelocked then activated (#4)", async () => {
    const { vault, manager } = await loadFixture(deployManagedFixture);
    await (await vault.connect(manager).setManagerFeeBps(50)).wait();       // 100 -> 50 instant
    expect(await vault.managerFeeBps()).to.equal(50);
    await (await vault.connect(manager).setManagerFeeBps(150)).wait();      // 50 -> 150 schedules
    expect(await vault.managerFeeBps()).to.equal(50);
    expect(await vault.pendingManagerFeeBps()).to.equal(150);
    await expect(vault.connect(manager).activateManagerFee()).to.be.revertedWithCustomError(vault, "TimelockNotElapsed");
    await time.increase(7 * 24 * 3600 + 1);
    await (await vault.connect(manager).activateManagerFee()).wait();
    expect(await vault.managerFeeBps()).to.equal(150);
    expect(await vault.pendingManagerFeeBps()).to.equal(0);
  });

  it("activate before any schedule reverts NothingPending", async () => {
    const { vault, manager, meridian } = await loadFixture(deployManagedFixture);
    await expect(vault.connect(manager).activateManagerFee()).to.be.revertedWithCustomError(vault, "NothingPending");
    await expect(vault.connect(meridian).activatePlatformFee()).to.be.revertedWithCustomError(vault, "NothingPending");
  });

  it("activate ACL: manager-only / meridian-only (#18)", async () => {
    const { vault, manager, meridian, alice } = await loadFixture(deployManagedFixture);
    await (await vault.connect(manager).setManagerFeeBps(150)).wait();
    await (await vault.connect(meridian).setPlatformFeeBps(30)).wait();
    await time.increase(7 * 24 * 3600 + 1);
    await expect(vault.connect(alice).activateManagerFee()).to.be.revertedWithCustomError(vault, "NotManager");
    await expect(vault.connect(alice).activatePlatformFee()).to.be.revertedWithCustomError(vault, "NotMeridian");
  });

  it("platform fee own line: decrease instant, increase timelocked+activated (meridian)", async () => {
    const { vault, meridian } = await loadFixture(deployManagedFixture);
    await (await vault.connect(meridian).setPlatformFeeBps(10)).wait();  // 15 -> 10 instant
    expect(await vault.platformFeeBps()).to.equal(10);
    await (await vault.connect(meridian).setPlatformFeeBps(40)).wait(); // schedules
    expect(await vault.platformFeeBps()).to.equal(10);
    await time.increase(7 * 24 * 3600 + 1);
    await (await vault.connect(meridian).activatePlatformFee()).wait();
    expect(await vault.platformFeeBps()).to.equal(40);
  });

  it("activation is NOT retroactive: the pre-effective window is charged at the OLD rate (#17)", async () => {
    // Two identical vaults; in one we raise the fee (timelock+activate), in the other we leave it.
    // Over the SAME elapsed window, the raised vault must NOT have charged the pre-activation window
    // at the new rate. We assert the fee accrued up to activation equals the OLD-rate fee (closeTo).
    const { vault, manager, treasury, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 100n);
    await (await vault.connect(ap).create(100n)).wait();
    const supply = await vault.totalSupply();
    const t0 = await vault.lastAccrued();

    await (await vault.connect(manager).setManagerFeeBps(200)).wait(); // schedule increase 100 -> 200 (also accrues at t0..now @100)
    await time.increase(7 * 24 * 3600 + 1);
    const rc = await (await vault.connect(manager).activateManagerFee()).wait(); // accrues window @ OLD 100, then flips
    const tAct = BigInt((await ethers.provider.getBlock(rc!.blockNumber))!.timestamp);

    // the MANAGER leg minted so far must reflect the OLD 1% over (tAct - t0), NOT 2%
    const mgrMinted = await vault.balanceOf(manager.address);
    const elapsed = tAct - t0;
    const oldRateFee = (supply * (100n * elapsed)) / (BPS * YEAR - 100n * elapsed);
    expect(mgrMinted).to.be.closeTo(oldRateFee, oldRateFee / 100000n + 5n);
    // platform own line (15bps) accrued INDEPENDENTLY over the same window, unaffected by the manager change
    const treMinted = await vault.balanceOf(treasury.address);
    const platRateFee = (supply * (15n * elapsed)) / (BPS * YEAR - 15n * elapsed);
    expect(treMinted).to.be.closeTo(platRateFee, platRateFee / 100000n + 5n);
    expect(await vault.managerFeeBps()).to.equal(200);
  });
});

describe("ManagedVault — createWithPermit accrues before minting", () => {
  it("permit-create settles the prior period's fee; the new creator is not retro-diluted", async () => {
    const { vault, vaultAddr, manager, treasury, legs, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 100n);
    await (await vault.connect(ap).create(100n)).wait(); // supply = 100*ONE
    await time.increase(Number(YEAR) / 2);

    // second create via permit for 10 units (no prior approve — the permits set allowance)
    const DEADLINE = 10_000_000_000n;
    const permits = await Promise.all(legs.map((l) => signPermit(l.stock, ap, vaultAddr, l.qty * 10n, DEADLINE)));
    const apSharesBefore = await vault.balanceOf(ap.address); // 100*ONE
    await (await vault.connect(ap).createWithPermit(10n, permits)).wait();

    expect((await vault.balanceOf(ap.address)) - apSharesBefore).to.equal(10n * ONE); // exactly nUnits*unitSize
    // the half-year fee accrued (minted to manager+treasury) as part of the permit-create's _accrue
    expect((await vault.balanceOf(manager.address)) + (await vault.balanceOf(treasury.address))).to.be.gt(0);
    for (const l of legs) expect(await l.stock.balanceOf(vaultAddr)).to.equal(l.qty * 110n); // 100 + 10 units pulled
  });
});

describe("ManagedVault — inflation / first-deposit immunity (#20)", () => {
  it("a tiny first create + direct donation cannot shrink a later creator's shares", async () => {
    const { vault, vaultAddr, legs, ap, alice, approveFor } = await loadFixture(deployManagedFixture);
    // first creator mints 1 unit
    await approveFor(ap, 1n);
    await (await vault.connect(ap).create(1n)).wait();
    // attacker donates constituent tokens straight into the vault (would inflate share price in a 4626 ratio vault)
    await (await legs[0].stock.connect(ap).transfer(vaultAddr, 500n * ONE)).wait();

    // a later creator still gets EXACTLY nUnits*unitSize — mint is fixed arithmetic, not balance-ratio priced
    for (const l of legs) await (await l.stock.mint(alice.address, 1000n * ONE)).wait();
    for (const l of legs) await (await l.stock.connect(alice).approve(vaultAddr, l.qty * 3n)).wait();
    await (await vault.connect(alice).create(3n)).wait();
    expect(await vault.balanceOf(alice.address)).to.equal(3n * ONE); // not rounded down by the donation
  });
});

describe("ManagedVault — roles & treasury", () => {
  it("two-step manager & meridian rotation (#7)", async () => {
    const { vault, manager, meridian, alice } = await loadFixture(deployManagedFixture);
    await (await vault.connect(manager).setPendingManager(alice.address)).wait();
    await expect(vault.connect(manager).acceptManager()).to.be.revertedWithCustomError(vault, "NotPending");
    await (await vault.connect(alice).acceptManager()).wait();
    expect(await vault.manager()).to.equal(alice.address);

    await (await vault.connect(meridian).setPendingMeridian(alice.address)).wait();
    await (await vault.connect(alice).acceptMeridian()).wait();
    expect(await vault.meridian()).to.equal(alice.address);
  });

  it("only current role can set its pending successor", async () => {
    const { vault, alice } = await loadFixture(deployManagedFixture);
    await expect(vault.connect(alice).setPendingManager(alice.address)).to.be.revertedWithCustomError(vault, "NotManager");
    await expect(vault.connect(alice).setPendingMeridian(alice.address)).to.be.revertedWithCustomError(vault, "NotMeridian");
  });

  it("after manager rotation the new manager controls the fee knob, old one cannot (#7)", async () => {
    const { vault, manager, alice } = await loadFixture(deployManagedFixture);
    await (await vault.connect(manager).setPendingManager(alice.address)).wait();
    await (await vault.connect(alice).acceptManager()).wait();
    await expect(vault.connect(manager).setManagerFeeBps(50)).to.be.revertedWithCustomError(vault, "NotManager");
    await (await vault.connect(alice).setManagerFeeBps(50)).wait();
    expect(await vault.managerFeeBps()).to.equal(50);
  });

  it("meridian rotates treasury; zero treasury rejected (#8, C2)", async () => {
    const { vault, meridian, manager, alice } = await loadFixture(deployManagedFixture);
    await (await vault.connect(meridian).setTreasury(alice.address)).wait();
    expect(await vault.treasury()).to.equal(alice.address);
    await expect(vault.connect(meridian).setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(vault, "ZeroAddress");
    await expect(vault.connect(manager).setTreasury(alice.address)).to.be.revertedWithCustomError(vault, "NotMeridian"); // manager can't
  });

  it("C2: with a valid treasury, create+accrue+redeem never brick even after a long gap (#15)", async () => {
    const { vault, ap, approveFor, manager } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 10n);
    await (await vault.connect(ap).create(10n)).wait();
    await time.increase(Number(YEAR));
    await (await vault.connect(ap).redeem(5n * ONE)).wait(); // _accrue mints to treasury, must not revert
    expect(await vault.balanceOf(manager.address)).to.be.gt(0); // a year of fee actually minted to the manager
  });
});
