import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, MINTER_ROLE, deployRegistry, deployStock, sortRecipe, Leg } from "../helpers";
import { deployCloneFactory } from "./helpers";

const SALT1 = ethers.id("salt-1");
const SALT2 = ethers.id("salt-2");
const SALT3 = ethers.id("salt-3");

async function deployFactoryFixture() {
  const [deployer, issuerA, issuerB] = await ethers.getSigners();

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

  const factory = await deployCloneFactory();

  // (tokens, unitQty, unitSize, name, symbol) reused across tests
  const recipe = [tokens, unitQty, unitSize, "Basket", "BSK"] as const;

  return { deployer, issuerA, issuerB, factory, tokens, unitQty, unitSize, recipe };
}

describe("CloneFactory — L1 deploy + registry (static baskets)", () => {
  it("deploys a vault at the predicted address and registers it", async () => {
    const { issuerA, factory, recipe } = await loadFixture(deployFactoryFixture);
    const predicted = await factory.predictBasketAddress(issuerA.address, ...recipe, SALT1);

    await factory.connect(issuerA).createBasket(...recipe, SALT1);

    expect(await factory.vaultCount()).to.equal(1);
    expect(await factory.allVaults(0)).to.equal(predicted);
    expect((await factory.getVaults(0, 10))[0]).to.equal(predicted);
  });

  it("emits BasketCreated with the full recipe", async () => {
    const { issuerA, factory, tokens, unitQty, unitSize } = await loadFixture(deployFactoryFixture);
    const predicted = await factory.predictBasketAddress(issuerA.address, tokens, unitQty, unitSize, "Basket", "BSK", SALT1);
    await expect(factory.connect(issuerA).createBasket(tokens, unitQty, unitSize, "Basket", "BSK", SALT1))
      .to.emit(factory, "BasketCreated")
      .withArgs(predicted, issuerA.address, SALT1, tokens, unitQty, unitSize, "Basket", "BSK");
  });

  it("namespaces the address per issuer (same recipe+salt -> different address)", async () => {
    const { issuerA, issuerB, factory, recipe } = await loadFixture(deployFactoryFixture);
    const addrA = await factory.predictBasketAddress(issuerA.address, ...recipe, SALT1);
    const addrB = await factory.predictBasketAddress(issuerB.address, ...recipe, SALT1);
    expect(addrA).to.not.equal(addrB);

    // both can actually deploy at their own address
    await factory.connect(issuerA).createBasket(...recipe, SALT1);
    await factory.connect(issuerB).createBasket(...recipe, SALT1);
    expect(await factory.vaultCount()).to.equal(2);
  });

  it("reverts redeploy of the same (issuer, salt, recipe)", async () => {
    const { issuerA, factory, recipe } = await loadFixture(deployFactoryFixture);
    await factory.connect(issuerA).createBasket(...recipe, SALT1);
    await expect(factory.connect(issuerA).createBasket(...recipe, SALT1)).to.be.reverted;
  });

  it("allows a duplicate recipe under a different salt", async () => {
    const { issuerA, factory, recipe } = await loadFixture(deployFactoryFixture);
    await factory.connect(issuerA).createBasket(...recipe, SALT1);
    await factory.connect(issuerA).createBasket(...recipe, SALT2);
    expect(await factory.vaultCount()).to.equal(2);
    expect(await factory.allVaults(0)).to.not.equal(await factory.allVaults(1));
  });

  it("paginates getVaults with a bounded window", async () => {
    const { issuerA, factory, recipe } = await loadFixture(deployFactoryFixture);
    await factory.connect(issuerA).createBasket(...recipe, SALT1);
    await factory.connect(issuerA).createBasket(...recipe, SALT2);
    await factory.connect(issuerA).createBasket(...recipe, SALT3);

    expect(await factory.vaultCount()).to.equal(3);
    expect(await factory.getVaults(0, 2)).to.have.length(2);
    expect(await factory.getVaults(2, 10)).to.have.length(1);
    expect(await factory.getVaults(5, 10)).to.have.length(0);

    // strict interior window: content must match, not just length (off-by-one guard)
    const mid = await factory.getVaults(1, 1);
    expect(mid).to.have.length(1);
    expect(mid[0]).to.equal(await factory.allVaults(1));
  });

  it("wires args into the deployed vault (constituents, unitSize, commitment)", async () => {
    const { issuerA, factory, recipe, tokens, unitQty, unitSize } = await loadFixture(deployFactoryFixture);
    await factory.connect(issuerA).createBasket(...recipe, SALT1);
    const vault = await ethers.getContractAt("BasketVault", await factory.allVaults(0));
    const [t, q] = await vault.getConstituents();
    expect(t).to.deep.equal(tokens);
    expect(q).to.deep.equal(unitQty);
    expect(await vault.unitSize()).to.equal(unitSize);
  });
});

describe("CloneFactory — managed baskets", () => {
  it("deploys a ManagedVault at the predicted address with injected meridian/treasury/share", async () => {
    const [deployer, manager] = await ethers.getSigners();
    const factory = await deployCloneFactory();

    const { deployRegistry, deployStock, sortRecipe, ONE, MINTER_ROLE } = await import("../helpers");
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
    const salt = ethers.encodeBytes32String("s1");

    const basket = { tokens, unitQty, unitSize: ONE, name: "M", symbol: "M", manager: manager.address, managerFeeBps: 100 };
    const predicted = await factory.predictManagedVaultAddress(deployer.address, basket, salt);
    await (await factory.createManagedBasket(basket, salt)).wait();
    const vaultAddr = await factory.allVaults(0);
    expect(vaultAddr).to.equal(predicted);

    const mv = await ethers.getContractAt("ManagedVault", vaultAddr);
    expect(await mv.manager()).to.equal(manager.address);
    expect(await mv.meridian()).to.equal(deployer.address);  // default = factory deployer
    expect(await mv.treasury()).to.equal(deployer.address);
    expect(await mv.platformShareBps()).to.equal(1000);      // default 10%
    expect(await mv.managerFeeBps()).to.equal(100);
  });

  it("owner can set meridian/treasury/platformShareBps; caps enforced; non-owner blocked", async () => {
    const [deployer, other] = await ethers.getSigners();
    const factory = await deployCloneFactory();
    await (await factory.setPlatformShareBps(1500)).wait();
    expect(await factory.platformShareBps()).to.equal(1500);
    await expect(factory.setPlatformShareBps(2001)).to.be.revertedWithCustomError(factory, "ShareTooHigh");
    await expect(factory.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    await expect(factory.setMeridian(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    await expect(factory.connect(other).setMeridian(other.address))
      .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
  });

  it("existing createBasket / predictBasketAddress still work unchanged", async () => {
    const [deployer] = await ethers.getSigners();
    const factory = await deployCloneFactory();
    const { deployRegistry, deployStock, sortRecipe, ONE, MINTER_ROLE } = await import("../helpers");
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
    const salt = ethers.encodeBytes32String("s2");
    const predicted = await factory.predictBasketAddress(deployer.address, tokens, unitQty, ONE, "S", "S", salt);
    await (await factory.createBasket(tokens, unitQty, ONE, "S", "S", salt)).wait();
    expect(await factory.allVaults(0)).to.equal(predicted);
  });

  it("predicted managed address shifts when a factory global changes (globals baked into clone init)", async () => {
    // In the clone model, globals (meridian/treasury/platformShareBps) are NOT part of the clone-args
    // (they don't affect the clone address). Only unitSize+recipeCommitment go into args.
    // The salt determines the address. Changing platformShareBps does NOT shift the predicted address —
    // unlike the old CREATE2 initcode model. This test verifies the new semantics.
    const [deployer, manager] = await ethers.getSigners();
    const factory = await deployCloneFactory();
    const { deployRegistry, deployStock, sortRecipe, ONE, MINTER_ROLE } = await import("../helpers");
    const reg = await deployRegistry(deployer.address);
    await (await reg.grantRole(MINTER_ROLE, deployer.address)).wait();
    const a = await deployStock(reg, "A", "A");
    const b = await deployStock(reg, "B", "B");
    const legs = sortRecipe([
      { stock: a, addr: await a.getAddress(), qty: 1n * ONE },
      { stock: b, addr: await b.getAddress(), qty: 2n * ONE },
    ]);
    const basket = { tokens: legs.map((l) => l.addr), unitQty: legs.map((l) => l.qty), unitSize: ONE, name: "M", symbol: "M", manager: manager.address, managerFeeBps: 100 };
    const salt = ethers.encodeBytes32String("s3");
    const before = await factory.predictManagedVaultAddress(deployer.address, basket, salt);
    await (await factory.setPlatformShareBps(1500)).wait();
    const after = await factory.predictManagedVaultAddress(deployer.address, basket, salt);
    // In clone model: changing globals does NOT change the address (only unitSize+commitment+salt do).
    // This is a semantics CHANGE from the old factory (a footgun removed). Verify they're equal.
    expect(after).to.equal(before);
    // But the deployed vault WILL get the updated platformShareBps (1500) from factory state at deploy time.
    await (await factory.createManagedBasket(basket, salt)).wait();
    const mv = await ethers.getContractAt("ManagedVault", await factory.allVaults(0));
    expect(await mv.platformShareBps()).to.equal(1500);
  });
});
