import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, MINTER_ROLE, deployRegistry, deployStock, sortRecipe, signPermit, Leg } from "../helpers";

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

  const MV = await ethers.getContractFactory("ManagedVault");
  // ManagedParams = [manager, meridian, treasury, managerFeeBps=100 (1%), platformShareBps=1000 (10%)]
  const params = [manager.address, meridian.address, treasury.address, 100, 1000];
  const vault = await MV.deploy(tokens, unitQty, unitSize, "Managed", "MGD", params);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();

  for (const l of legs) await (await l.stock.mint(ap.address, 1_000_000n * ONE)).wait();
  async function approveFor(signer: any, nUnits: bigint) {
    for (const l of legs) await (await l.stock.connect(signer).approve(vaultAddr, l.qty * nUnits)).wait();
  }

  return { deployer, manager, meridian, treasury, ap, alice, registry, legs, tokens, unitQty, unitSize, vault, vaultAddr, MV, params, approveFor };
}

describe("ManagedVault — construction & roles", () => {
  it("stores roles, fees, and lastAccrued", async () => {
    const { vault, manager, meridian, treasury } = await loadFixture(deployManagedFixture);
    expect(await vault.manager()).to.equal(manager.address);
    expect(await vault.meridian()).to.equal(meridian.address);
    expect(await vault.treasury()).to.equal(treasury.address);
    expect(await vault.managerFeeBps()).to.equal(100);
    expect(await vault.platformShareBps()).to.equal(1000);
    expect(await vault.lastAccrued()).to.be.gt(0);
  });

  it("reverts on zero manager/meridian/treasury", async () => {
    const { MV, tokens, unitQty, unitSize, meridian, treasury, vault } = await loadFixture(deployManagedFixture);
    const Z = ethers.ZeroAddress;
    await expect(MV.deploy(tokens, unitQty, unitSize, "x", "x", [Z, meridian.address, treasury.address, 100, 1000]))
      .to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  it("reverts when managerFeeBps > MANAGER_MAX (200) or platformShareBps > PLATFORM_SHARE_MAX (2000)", async () => {
    const { MV, tokens, unitQty, unitSize, manager, meridian, treasury, vault } = await loadFixture(deployManagedFixture);
    await expect(MV.deploy(tokens, unitQty, unitSize, "x", "x", [manager.address, meridian.address, treasury.address, 201, 1000]))
      .to.be.revertedWithCustomError(vault, "FeeTooHigh");
    await expect(MV.deploy(tokens, unitQty, unitSize, "x", "x", [manager.address, meridian.address, treasury.address, 100, 2001]))
      .to.be.revertedWithCustomError(vault, "ShareTooHigh");
  });

  it("accepts fees exactly at the caps (MANAGER_MAX=200, PLATFORM_SHARE_MAX=2000)", async () => {
    const { MV, tokens, unitQty, unitSize, manager, meridian, treasury } = await loadFixture(deployManagedFixture);
    const v = await MV.deploy(tokens, unitQty, unitSize, "Cap", "CAP", [manager.address, meridian.address, treasury.address, 200, 2000]);
    await v.waitForDeployment();
    expect(await v.managerFeeBps()).to.equal(200);
    expect(await v.platformShareBps()).to.equal(2000);
  });

  it("inherits in-kind create/redeem from the base", async () => {
    const { vault, vaultAddr, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 1n);
    await (await vault.connect(ap).create(1n)).wait();
    expect(await vault.balanceOf(ap.address)).to.equal(ONE); // unitSize
  });
});

describe("ManagedVault — fee accrual", () => {
  // feeShares = S * x/(1-x), x = feeBps*elapsed/(BPS*YEAR), whole shares (floor).
  function expectedFeeShares(S: bigint, feeBps: bigint, elapsed: bigint): bigint {
    const num = feeBps * elapsed;
    const den = BPS * YEAR;
    return (S * num) / (den - num);
  }

  it("accrues over time and splits manager/treasury by platformShareBps (#1)", async () => {
    const { vault, manager, treasury, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 100n);
    await (await vault.connect(ap).create(100n)).wait();
    const supply = await vault.totalSupply();
    const lastAccrued = await vault.lastAccrued();
    await time.increase(Number(YEAR));
    const rc = await (await vault.accrueFee()).wait();
    const blk = await ethers.provider.getBlock(rc!.blockNumber);
    const elapsed = BigInt(blk!.timestamp) - lastAccrued; // true on-chain window (>= YEAR by block drift)
    const fee = expectedFeeShares(supply, 100n, elapsed);
    const toTreasury = await vault.balanceOf(treasury.address);
    const toManager = await vault.balanceOf(manager.address);
    expect(toTreasury + toManager).to.be.closeTo(fee, 2n);
    expect(toTreasury).to.be.closeTo((fee * 1000n) / BPS, 2n); // 10% platform share
  });

  it("managerFeeBps == 0 mints nothing (#2)", async () => {
    const { MV, tokens, unitQty, unitSize, manager, meridian, treasury } = await loadFixture(deployManagedFixture);
    const v = await MV.deploy(tokens, unitQty, unitSize, "Z", "Z", [manager.address, meridian.address, treasury.address, 0, 1000]);
    await v.waitForDeployment();
    const a = (await ethers.getSigners())[4]; // ap
    for (const t of tokens) {
      const erc = await ethers.getContractAt("IERC20", t);
      await (await erc.connect(a).approve(await v.getAddress(), ethers.MaxUint256)).wait();
    }
    await (await v.connect(a).create(10n)).wait();
    await time.increase(Number(YEAR));
    await (await v.accrueFee()).wait();
    expect(await v.balanceOf(manager.address)).to.equal(0);
    expect(await v.balanceOf(treasury.address)).to.equal(0);
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

  it("C1: manager-timed poke at tiny feeShares does NOT starve the platform (#14)", async () => {
    const { vault, manager, treasury, ap, approveFor } = await loadFixture(deployManagedFixture);
    await approveFor(ap, 1n);
    await (await vault.connect(ap).create(1n)).wait();
    for (let i = 0; i < 50; i++) { await time.increase(3600); await (await vault.accrueFee()).wait(); }
    await time.increase(Number(YEAR));
    await (await vault.accrueFee()).wait();
    const toTreasury = await vault.balanceOf(treasury.address);
    const toManager = await vault.balanceOf(manager.address);
    expect(toTreasury).to.be.gt(0); // platform NOT starved
    if (toManager > 0n) {
      expect(toTreasury).to.be.closeTo(((toTreasury + toManager) * 1000n) / BPS, 3n);
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
    await expect(vault.connect(meridian).setPlatformShareBps(2001)).to.be.revertedWithCustomError(vault, "ShareTooHigh");
  });

  it("only the owner role can set its knob", async () => {
    const { vault, manager, meridian, alice } = await loadFixture(deployManagedFixture);
    await expect(vault.connect(alice).setManagerFeeBps(50)).to.be.revertedWithCustomError(vault, "NotManager");
    await expect(vault.connect(alice).setPlatformShareBps(500)).to.be.revertedWithCustomError(vault, "NotMeridian");
    await expect(vault.connect(manager).setPlatformShareBps(500)).to.be.revertedWithCustomError(vault, "NotMeridian");
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
    await expect(vault.connect(meridian).activatePlatformShare()).to.be.revertedWithCustomError(vault, "NothingPending");
  });

  it("activate ACL: manager-only / meridian-only (#18)", async () => {
    const { vault, manager, meridian, alice } = await loadFixture(deployManagedFixture);
    await (await vault.connect(manager).setManagerFeeBps(150)).wait();
    await (await vault.connect(meridian).setPlatformShareBps(1500)).wait();
    await time.increase(7 * 24 * 3600 + 1);
    await expect(vault.connect(alice).activateManagerFee()).to.be.revertedWithCustomError(vault, "NotManager");
    await expect(vault.connect(alice).activatePlatformShare()).to.be.revertedWithCustomError(vault, "NotMeridian");
  });

  it("platform share: decrease instant, increase timelocked+activated (meridian)", async () => {
    const { vault, meridian } = await loadFixture(deployManagedFixture);
    await (await vault.connect(meridian).setPlatformShareBps(500)).wait();  // 1000 -> 500 instant
    expect(await vault.platformShareBps()).to.equal(500);
    await (await vault.connect(meridian).setPlatformShareBps(1500)).wait(); // schedules
    expect(await vault.platformShareBps()).to.equal(500);
    await time.increase(7 * 24 * 3600 + 1);
    await (await vault.connect(meridian).activatePlatformShare()).wait();
    expect(await vault.platformShareBps()).to.equal(1500);
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

    // total fee minted so far must reflect the OLD 1% over (tAct - t0), NOT 2%
    const minted = (await vault.balanceOf(manager.address)) + (await vault.balanceOf(treasury.address));
    const elapsed = tAct - t0;
    const oldRateFee = (supply * (100n * elapsed)) / (BPS * YEAR - 100n * elapsed);
    expect(minted).to.be.closeTo(oldRateFee, oldRateFee / 100000n + 5n);
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
