import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

async function deploy() {
  const [owner, manager] = await ethers.getSigners();
  const Bv = await ethers.getContractFactory("BasketVault"); const bImpl = await Bv.deploy();
  const Mv = await ethers.getContractFactory("ManagedVault"); const mImpl = await Mv.deploy();
  const Cv = await ethers.getContractFactory("CommittedVault"); const cImpl = await Cv.deploy();
  const Rv = await ethers.getContractFactory("ManagedRebalanceVault"); const rImpl = await Rv.deploy();
  const Km = await ethers.getContractFactory("KeeperModule"); const km = await Km.deploy(owner.address);
  const F = await ethers.getContractFactory("CloneFactory");
  const f = await F.deploy(await bImpl.getAddress(), await mImpl.getAddress(), await cImpl.getAddress());
  await f.setRebalanceImpl(await rImpl.getAddress());

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A","A",18); const b = await Tok.deploy("B","B",18);
  let [t0,t1] = [await a.getAddress(), await b.getAddress()]; if (BigInt(t0)>BigInt(t1)) [t0,t1]=[t1,t0];
  await f.setConstituentAllowed(t0, true); await f.setConstituentAllowed(t1, true);
  return { f, owner, manager, km, tokens: [t0,t1] };
}

describe("CloneFactory — rebalance path + whitelist", () => {
  it("rejects a non-whitelisted constituent", async () => {
    const { f, manager, km, tokens } = await loadFixture(deploy);
    const bad = "0x000000000000000000000000000000000000dEaD";
    await expect(f.createRebalanceBasket(
      { tokens: [tokens[0], bad], unitQty: [ONE, ONE], unitSize: ONE, name: "X", symbol: "X",
        manager: manager.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress() },
      ethers.ZeroHash
    )).to.be.revertedWithCustomError(f, "NotWhitelisted");
  });

  it("deploys a rebalanceable clone for whitelisted constituents", async () => {
    const { f, manager, km, tokens } = await loadFixture(deploy);
    const vault = await f.createRebalanceBasket.staticCall(
      { tokens, unitQty: [ONE, ONE], unitSize: ONE, name: "RB", symbol: "RB",
        manager: manager.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress() },
      ethers.ZeroHash
    );
    expect(vault).to.properAddress;
  });

  it("a deployed rebalanceable vault has keeperBps/keeperEscrow wired and is registered", async () => {
    const { f, manager, km, tokens } = await loadFixture(deploy);
    const params = { tokens, unitQty: [ONE, ONE], unitSize: ONE, name: "RB", symbol: "RB",
      manager: manager.address, managerFeeBps: 50, keeperBps: 100, keeperEscrow: await km.getAddress() };
    const vaultAddr = await f.createRebalanceBasket.staticCall(params, ethers.ZeroHash);
    await f.createRebalanceBasket(params, ethers.ZeroHash);
    const vault = await ethers.getContractAt("ManagedRebalanceVault", vaultAddr);
    expect(await vault.keeperBps()).to.equal(100);
    expect(await vault.keeperEscrow()).to.equal(await km.getAddress());
    expect(await vault.manager()).to.equal(manager.address);
    expect(await f.vaultCount()).to.equal(1);
  });

  it("setRebalanceImpl rejects the zero address", async () => {
    const { f } = await loadFixture(deploy);
    await expect(f.setRebalanceImpl(ethers.ZeroAddress)).to.be.revertedWithCustomError(f, "ZeroAddress");
  });
});
