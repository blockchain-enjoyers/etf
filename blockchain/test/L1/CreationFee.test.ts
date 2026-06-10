import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, MINTER_ROLE, deployRegistry, deployStock, sortRecipe } from "../helpers";
import { deployCloneFactory } from "./helpers";

// VaultType enum order in CloneFactory: BASKET=0, COMMITTED=1, MANAGED=2, REBALANCE=3, REGISTRY=4
const BASKET = 0;

async function fixture() {
  const [deployer, treasury, payer] = await ethers.getSigners();
  const factory = await deployCloneFactory();
  await (await factory.setTreasury(treasury.address)).wait();

  // a valid 2-constituent recipe (strictly-ascending addresses)
  const reg = await deployRegistry(deployer.address);
  await (await reg.grantRole(MINTER_ROLE, deployer.address)).wait();
  const a = await deployStock(reg, "A", "A");
  const b = await deployStock(reg, "B", "B");
  const legs = sortRecipe([
    { stock: a, addr: await a.getAddress(), qty: 1n * ONE },
    { stock: b, addr: await b.getAddress(), qty: 2n * ONE },
  ]);
  const tokens = legs.map((l) => l.addr);
  const unitQty = legs.map((l) => l.qty);

  // a USDG-like 18-dec fee token, funded to the payer
  const fee = await (await ethers.getContractFactory("MockERC20Decimals")).deploy("USDG", "USDG", 18);
  await (await fee.mint(payer.address, 1000n * ONE)).wait();

  return { deployer, treasury, payer, factory, tokens, unitQty, fee };
}

describe("CloneFactory — fund-creation fee", () => {
  it("charges the per-type fee from the deployer to the treasury on createBasket", async () => {
    const { treasury, payer, factory, tokens, unitQty, fee } = await loadFixture(fixture);
    await (await factory.setCreationFeeToken(await fee.getAddress())).wait();
    await (await factory.setCreationFee(BASKET, 50n * ONE)).wait();
    await (await fee.connect(payer).approve(await factory.getAddress(), 50n * ONE)).wait();

    await expect(
      factory.connect(payer).createBasket(tokens, unitQty, ONE, "S", "S", ethers.id("s1"))
    ).to.changeTokenBalances(fee, [payer, treasury], [-(50n * ONE), 50n * ONE]);
  });

  it("emits CreationFeeCharged with the type, payer, token and amount", async () => {
    const { payer, factory, tokens, unitQty, fee } = await loadFixture(fixture);
    await (await factory.setCreationFeeToken(await fee.getAddress())).wait();
    await (await factory.setCreationFee(BASKET, 50n * ONE)).wait();
    await (await fee.connect(payer).approve(await factory.getAddress(), 50n * ONE)).wait();

    await expect(factory.connect(payer).createBasket(tokens, unitQty, ONE, "S", "S", ethers.id("s2")))
      .to.emit(factory, "CreationFeeCharged")
      .withArgs(BASKET, payer.address, await fee.getAddress(), 50n * ONE);
  });

  it("default fee is 0 — no token, no approval, no charge", async () => {
    const { payer, factory, tokens, unitQty, fee } = await loadFixture(fixture);
    await expect(
      factory.connect(payer).createBasket(tokens, unitQty, ONE, "S", "S", ethers.id("s3"))
    ).to.not.be.reverted;
    expect(await fee.balanceOf(payer.address)).to.equal(1000n * ONE);
  });

  it("fee is per-type: a BASKET fee does NOT apply to a MANAGED deploy", async () => {
    const { deployer, treasury, factory, tokens, unitQty, fee } = await loadFixture(fixture);
    await (await factory.setCreationFeeToken(await fee.getAddress())).wait();
    await (await factory.setCreationFee(BASKET, 50n * ONE)).wait(); // MANAGED stays 0
    const basket = { tokens, unitQty, unitSize: ONE, name: "M", symbol: "M", manager: deployer.address, managerFeeBps: 100 };
    const t0 = await fee.balanceOf(treasury.address);
    await expect(factory.createManagedBasket(basket, ethers.id("m1"))).to.not.be.reverted;
    expect(await fee.balanceOf(treasury.address)).to.equal(t0); // unchanged — MANAGED fee is 0
  });

  it("setters are onlyOwner", async () => {
    const { payer, factory, fee } = await loadFixture(fixture);
    await expect(factory.connect(payer).setCreationFeeToken(await fee.getAddress()))
      .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    await expect(factory.connect(payer).setCreationFee(BASKET, 1n))
      .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
  });

  it("reverts when a fee is set but the fee token is unset (owner misconfig)", async () => {
    const { payer, factory, tokens, unitQty } = await loadFixture(fixture);
    await (await factory.setCreationFee(BASKET, 50n * ONE)).wait(); // creationFeeToken still address(0)
    await expect(
      factory.connect(payer).createBasket(tokens, unitQty, ONE, "S", "S", ethers.id("s4"))
    ).to.be.reverted;
  });
});
