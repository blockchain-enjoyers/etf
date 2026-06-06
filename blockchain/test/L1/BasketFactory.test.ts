import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, MINTER_ROLE, deployRegistry, deployStock, sortRecipe, Leg } from "../helpers";

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

  const Factory = await ethers.getContractFactory("BasketFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  // (tokens, unitQty, unitSize, name, symbol) reused across tests
  const recipe = [tokens, unitQty, unitSize, "Basket", "BSK"] as const;

  return { deployer, issuerA, issuerB, factory, tokens, unitQty, unitSize, recipe };
}

describe("BasketFactory — L1 deploy + registry", () => {
  it("deploys a vault at the predicted CREATE2 address and registers it", async () => {
    const { issuerA, factory, recipe } = await loadFixture(deployFactoryFixture);
    const predicted = await factory.predictVaultAddress(issuerA.address, ...recipe, SALT1);

    await factory.connect(issuerA).createBasket(...recipe, SALT1);

    expect(await factory.vaultCount()).to.equal(1);
    expect(await factory.allVaults(0)).to.equal(predicted);
    expect((await factory.getVaults(0, 10))[0]).to.equal(predicted);
  });

  it("emits BasketCreated with the full recipe", async () => {
    const { issuerA, factory, tokens, unitQty, unitSize } = await loadFixture(deployFactoryFixture);
    const predicted = await factory.predictVaultAddress(issuerA.address, tokens, unitQty, unitSize, "Basket", "BSK", SALT1);
    await expect(factory.connect(issuerA).createBasket(tokens, unitQty, unitSize, "Basket", "BSK", SALT1))
      .to.emit(factory, "BasketCreated")
      .withArgs(predicted, issuerA.address, SALT1, tokens, unitQty, unitSize, "Basket", "BSK");
  });

  it("namespaces the address per issuer (same recipe+salt -> different address)", async () => {
    const { issuerA, issuerB, factory, recipe } = await loadFixture(deployFactoryFixture);
    const addrA = await factory.predictVaultAddress(issuerA.address, ...recipe, SALT1);
    const addrB = await factory.predictVaultAddress(issuerB.address, ...recipe, SALT1);
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

  it("wires constructor args into the deployed vault", async () => {
    const { issuerA, factory, recipe, tokens, unitQty, unitSize } = await loadFixture(deployFactoryFixture);
    await factory.connect(issuerA).createBasket(...recipe, SALT1);
    const vault = await ethers.getContractAt("BasketVault", await factory.allVaults(0));
    const [t, q] = await vault.getConstituents();
    expect(t).to.deep.equal(tokens);
    expect(q).to.deep.equal(unitQty);
    expect(await vault.unitSize()).to.equal(unitSize);
  });
});

describe("BasketFactory — managed baskets", () => {
  it("deploys a ManagedVault at the predicted address with injected meridian/treasury/share", async () => {
    const [deployer, manager] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BasketFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();

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

    const basket = [tokens, unitQty, ONE, "M", "M", manager.address, 100]; // ManagedBasket struct (tuple)
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
    const Factory = await ethers.getContractFactory("BasketFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    await (await factory.setPlatformShareBps(1500)).wait();
    expect(await factory.platformShareBps()).to.equal(1500);
    await expect(factory.setPlatformShareBps(2001)).to.be.revertedWithCustomError(factory, "ShareTooHigh");
    await expect(factory.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    await expect(factory.setMeridian(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    await expect(factory.connect(other).setMeridian(other.address))
      .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
  });

  it("existing createBasket / predictVaultAddress still work unchanged", async () => {
    const [deployer] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BasketFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
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
    const predicted = await factory.predictVaultAddress(deployer.address, tokens, unitQty, ONE, "S", "S", salt);
    await (await factory.createBasket(tokens, unitQty, ONE, "S", "S", salt)).wait();
    expect(await factory.allVaults(0)).to.equal(predicted);
  });

  it("predicted managed address shifts when a factory global changes (initcode bakes in the globals)", async () => {
    const [deployer, manager] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BasketFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    const { deployRegistry, deployStock, sortRecipe, ONE, MINTER_ROLE } = await import("../helpers");
    const reg = await deployRegistry(deployer.address);
    await (await reg.grantRole(MINTER_ROLE, deployer.address)).wait();
    const a = await deployStock(reg, "A", "A");
    const b = await deployStock(reg, "B", "B");
    const legs = sortRecipe([
      { stock: a, addr: await a.getAddress(), qty: 1n * ONE },
      { stock: b, addr: await b.getAddress(), qty: 2n * ONE },
    ]);
    const basket = [legs.map((l) => l.addr), legs.map((l) => l.qty), ONE, "M", "M", manager.address, 100];
    const salt = ethers.encodeBytes32String("s3");
    const before = await factory.predictManagedVaultAddress(deployer.address, basket, salt);
    await (await factory.setPlatformShareBps(1500)).wait(); // baked into managed initcode
    const after = await factory.predictManagedVaultAddress(deployer.address, basket, salt);
    expect(after).to.not.equal(before); // footgun: predict only stable while globals unchanged
  });
});
