import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, MINTER_ROLE, deployRegistry, deployStock, sortRecipe, Leg } from "../helpers";
import { deployCloneFactory } from "./helpers";

async function deploy() {
  const [deployer, manager, meridian, treasury, ap] = await ethers.getSigners();
  const registry = await deployRegistry(deployer.address);
  await (await registry.grantRole(MINTER_ROLE, deployer.address)).wait();
  const a = await deployStock(registry, "Alpha", "ALPHA");
  const b = await deployStock(registry, "Beta", "BETA");
  const legs: Leg[] = sortRecipe([
    { stock: a, addr: await a.getAddress(), qty: 2n * ONE },
    { stock: b, addr: await b.getAddress(), qty: 3n * ONE },
  ]);
  const tokens = legs.map((l) => l.addr), unitQty = legs.map((l) => l.qty);

  // USDG stand-in (18-dec full ERC20)
  const usdg = await (await ethers.getContractFactory("MockERC20Decimals")).deploy("USDG", "USDG", 18);

  const factory = await deployCloneFactory();
  await (await factory.setMeridian(meridian.address)).wait();
  await (await factory.setTreasury(treasury.address)).wait();
  await (await factory.setFeeToken(await usdg.getAddress())).wait();
  await (await factory.setDefaultFlatFees(5n * ONE, 4n * ONE)).wait(); // $5 create, $4 redeem (config)

  const basket = { tokens, unitQty, unitSize: ONE, name: "M", symbol: "M", manager: manager.address, managerFeeBps: 100 };
  const salt = ethers.id("flatfee-fixture");
  const addr = await factory.predictManagedVaultAddress(deployer.address, basket, salt);
  await (await factory.createManagedBasket(basket, salt)).wait();
  const vault = await ethers.getContractAt("ManagedVault", addr);

  for (const l of legs) await (await l.stock.mint(ap.address, 1_000_000n * ONE)).wait();
  for (const l of legs) await (await l.stock.connect(ap).approve(addr, l.qty * 1000n)).wait();
  await (await usdg.mint(ap.address, 1000n * ONE)).wait();
  return { deployer, manager, meridian, treasury, ap, vault, addr, usdg, legs, factory, basket };
}

// Variant: factory has a non-zero default flat fee but feeToken left UNSET.
async function deployFeeNoToken() {
  const [deployer, manager, meridian, treasury] = await ethers.getSigners();
  const registry = await deployRegistry(deployer.address);
  await (await registry.grantRole(MINTER_ROLE, deployer.address)).wait();
  const a = await deployStock(registry, "Alpha", "ALPHA");
  const b = await deployStock(registry, "Beta", "BETA");
  const legs: Leg[] = sortRecipe([
    { stock: a, addr: await a.getAddress(), qty: 2n * ONE },
    { stock: b, addr: await b.getAddress(), qty: 3n * ONE },
  ]);
  const tokens = legs.map((l) => l.addr), unitQty = legs.map((l) => l.qty);

  const factory = await deployCloneFactory();
  await (await factory.setMeridian(meridian.address)).wait();
  await (await factory.setTreasury(treasury.address)).wait();
  // feeToken deliberately NOT set; a non-zero create fee is configured.
  await (await factory.setDefaultFlatFees(5n * ONE, 0n)).wait();

  const basket = { tokens, unitQty, unitSize: ONE, name: "M", symbol: "M", manager: manager.address, managerFeeBps: 100 };
  const salt = ethers.id("flatfee-no-token");
  return { factory, basket, salt };
}

// Variant: a managed vault with feeToken UNSET and both flat fees 0 (a clean no-fee vault).
async function deployNoFee() {
  const [deployer, manager, meridian, treasury] = await ethers.getSigners();
  const registry = await deployRegistry(deployer.address);
  await (await registry.grantRole(MINTER_ROLE, deployer.address)).wait();
  const a = await deployStock(registry, "Alpha", "ALPHA");
  const b = await deployStock(registry, "Beta", "BETA");
  const legs: Leg[] = sortRecipe([
    { stock: a, addr: await a.getAddress(), qty: 2n * ONE },
    { stock: b, addr: await b.getAddress(), qty: 3n * ONE },
  ]);
  const tokens = legs.map((l) => l.addr), unitQty = legs.map((l) => l.qty);

  const factory = await deployCloneFactory();
  await (await factory.setMeridian(meridian.address)).wait();
  await (await factory.setTreasury(treasury.address)).wait();
  // feeToken left at address(0), default flat fees stay 0.

  const basket = { tokens, unitQty, unitSize: ONE, name: "M", symbol: "M", manager: manager.address, managerFeeBps: 100 };
  const salt = ethers.id("flatfee-no-fee");
  const addr = await factory.predictManagedVaultAddress(deployer.address, basket, salt);
  await (await factory.createManagedBasket(basket, salt)).wait();
  const vault = await ethers.getContractAt("ManagedVault", addr);
  return { deployer, manager, meridian, treasury, vault, addr };
}

describe("Flat create fee", () => {
  it("pulls a fixed USDG fee from the creator to treasury on create", async () => {
    const { ap, treasury, vault, addr, usdg } = await loadFixture(deploy);
    await (await usdg.connect(ap).approve(addr, 5n * ONE)).wait();
    const apBefore = await usdg.balanceOf(ap.address);
    await (await vault.connect(ap).create(2n)).wait();
    expect(await usdg.balanceOf(ap.address)).to.equal(apBefore - 5n * ONE);
    expect(await usdg.balanceOf(treasury.address)).to.equal(5n * ONE);
    expect(await vault.balanceOf(ap.address)).to.equal(2n * ONE); // shares minted normally
  });

  it("reverts create if the creator has not approved the USDG fee", async () => {
    const { ap, vault } = await loadFixture(deploy);
    await expect(vault.connect(ap).create(1n)).to.be.reverted; // USDG allowance missing
  });

  it("setFlatCreateFee above FLAT_FEE_MAX reverts; only meridian can set", async () => {
    const { meridian, ap, vault } = await loadFixture(deploy);
    const cap = await vault.FLAT_FEE_MAX();
    await expect(vault.connect(meridian).setFlatCreateFee(cap + 1n)).to.be.revertedWithCustomError(vault, "FlatFeeTooHigh");
    await expect(vault.connect(ap).setFlatCreateFee(1n)).to.be.revertedWithCustomError(vault, "NotMeridian");
  });

  it("in-kind redeem charges NO flat fee (unconditional exit)", async () => {
    const { ap, vault, addr, usdg } = await loadFixture(deploy);
    await (await usdg.connect(ap).approve(addr, 5n * ONE)).wait();
    await (await vault.connect(ap).create(2n)).wait();
    const usdgBefore = await usdg.balanceOf(ap.address);
    await (await vault.connect(ap).redeem(1n * ONE)).wait();
    expect(await usdg.balanceOf(ap.address)).to.equal(usdgBefore); // redeem pulled no USDG
  });
});

describe("Flat fee — feeToken no-brick guard", () => {
  it("init reverts FeeTokenUnset when a flat fee is non-zero but feeToken is unset", async () => {
    const { factory, basket, salt } = await loadFixture(deployFeeNoToken);
    const impl = await ethers.getContractAt("ManagedVault", await factory.managedImpl());
    await expect(factory.createManagedBasket(basket, salt)).to.be.revertedWithCustomError(impl, "FeeTokenUnset");
  });

  it("setFeeToken(0) reverts FeeTokenUnset while a flat fee is live", async () => {
    const { meridian, vault } = await loadFixture(deploy);
    await expect(
      vault.connect(meridian).setFeeToken(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(vault, "FeeTokenUnset");
  });

  it("setFlatCreateFee(>0) reverts FeeTokenUnset when feeToken is unset", async () => {
    const { meridian, vault } = await loadFixture(deployNoFee);
    await expect(
      vault.connect(meridian).setFlatCreateFee(1n)
    ).to.be.revertedWithCustomError(vault, "FeeTokenUnset");
  });
});
