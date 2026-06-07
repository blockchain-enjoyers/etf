import { ethers } from "hardhat";
import { ONE } from "../helpers";

export { ONE };

// ---- CloneFactory deploy helpers ----

/// Deploy a fresh CloneFactory with the three implementation contracts.
export async function deployCloneFactory() {
  const implAddr = async (name: string) =>
    (await (await ethers.getContractFactory(name)).deploy()).getAddress();
  const F = await ethers.getContractFactory("CloneFactory");
  const factory = await F.deploy(
    await implAddr("BasketVault"),
    await implAddr("ManagedVault"),
    await implAddr("CommittedVault")
  );
  await factory.waitForDeployment();
  return factory;
}

/// Deploy a static BasketVault via the factory; returns an attached BasketVault instance.
export async function deployBasketVault(
  tokens: string[],
  unitQty: bigint[],
  unitSize: bigint,
  name = "Basket",
  symbol = "BSK"
) {
  const [issuer] = await ethers.getSigners();
  const factory = await deployCloneFactory();
  const salt = ethers.id(name + symbol + tokens.join());
  const addr = await factory.predictBasketAddress(
    issuer.address, tokens, unitQty, unitSize, name, symbol, salt
  );
  await (await factory.createBasket(tokens, unitQty, unitSize, name, symbol, salt)).wait();
  return ethers.getContractAt("BasketVault", addr);
}

/// Deploy a ManagedVault via the factory; returns an attached ManagedVault instance.
export async function deployManagedVault(
  tokens: string[],
  unitQty: bigint[],
  unitSize: bigint,
  name: string,
  symbol: string,
  manager: string,
  managerFeeBps: number
) {
  const [issuer] = await ethers.getSigners();
  const factory = await deployCloneFactory();
  const salt = ethers.id(name + symbol + tokens.join() + manager);
  const basket = {
    tokens,
    unitQty,
    unitSize,
    name,
    symbol,
    manager,
    managerFeeBps,
  };
  const addr = await factory.predictManagedVaultAddress(issuer.address, basket, salt);
  await (await factory.createManagedBasket(basket, salt)).wait();
  return ethers.getContractAt("ManagedVault", addr);
}

/// Deploy a CommittedVault via the factory; returns an attached CommittedVault instance.
export async function deployCommittedVault(
  tokens: string[],
  unitQty: bigint[],
  unitSize: bigint,
  name = "Committed",
  symbol = "CMT"
) {
  const [issuer] = await ethers.getSigners();
  const factory = await deployCloneFactory();
  const salt = ethers.id(name + symbol + tokens.join());
  const addr = await factory.predictCommittedVaultAddress(
    issuer.address, tokens, unitQty, unitSize, name, symbol, salt
  );
  await (await factory.createCommittedBasket(tokens, unitQty, unitSize, name, symbol, salt)).wait();
  return ethers.getContractAt("CommittedVault", addr);
}
