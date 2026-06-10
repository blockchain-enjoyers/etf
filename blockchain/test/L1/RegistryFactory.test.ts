import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"];

async function deploy() {
  const [owner, manager] = await ethers.getSigners();
  const Bv = await ethers.getContractFactory("BasketVault"); const bImpl = await Bv.deploy();
  const Mv = await ethers.getContractFactory("ManagedVault"); const mImpl = await Mv.deploy();
  const Cv = await ethers.getContractFactory("CommittedVault"); const cImpl = await Cv.deploy();
  const Rrv = await ethers.getContractFactory("RegistryRebalanceVault"); const rrImpl = await Rrv.deploy();
  const Km = await ethers.getContractFactory("KeeperModule"); const km = await Km.deploy(owner.address);
  const F = await ethers.getContractFactory("CloneFactory");
  const f = await F.deploy(await bImpl.getAddress(), await mImpl.getAddress(), await cImpl.getAddress());
  await f.setRegistryRebalanceImpl(await rrImpl.getAddress());

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18); const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  if (BigInt(t0) > BigInt(t1)) [t0, t1] = [t1, t0];
  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;
  await f.setConstituentAllowed(t0, true); await f.setConstituentAllowed(t1, true);

  const root = StandardMerkleTree.of(tokens.map((t, i) => [t, unitQty[i].toString(), unitSize.toString()]), ENC).root;
  const idx = { genesisRoot: root, tokens, unitSize, name: "RX", symbol: "RX",
    manager: manager.address, managerFeeBps: 50, keeperBps: 100, keeperEscrow: await km.getAddress() };

  return { f, owner, manager, km, tokens, unitSize, root, idx };
}

describe("CloneFactory — registry index path", () => {
  it("setRegistryRebalanceImpl rejects the zero address", async () => {
    const { f } = await loadFixture(deploy);
    await expect(f.setRegistryRebalanceImpl(ethers.ZeroAddress)).to.be.revertedWithCustomError(f, "ZeroAddress");
  });

  it("rejects a non-whitelisted constituent", async () => {
    const { f, idx } = await loadFixture(deploy);
    const bad = { ...idx, tokens: [idx.tokens[0], "0x000000000000000000000000000000000000dEaD"] };
    await expect(f.createRegistryIndex(bad, ethers.ZeroHash)).to.be.revertedWithCustomError(f, "NotWhitelisted");
  });

  it("rejects a zero genesis root", async () => {
    const { f, idx } = await loadFixture(deploy);
    await expect(f.createRegistryIndex({ ...idx, genesisRoot: ethers.ZeroHash }, ethers.ZeroHash))
      .to.be.revertedWithCustomError(f, "ZeroRoot");
  });

  it("deploys a clone whose recipeCommitment() == genesis root, with manager/keeper wired + registered", async () => {
    const { f, manager, km, idx, root } = await loadFixture(deploy);
    const vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
    await f.createRegistryIndex(idx, ethers.ZeroHash);
    const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);
    expect(await vault.recipeCommitment()).to.equal(root);
    expect(await vault.recipeRoot()).to.equal(root);
    expect(await vault.manager()).to.equal(manager.address);
    expect(await vault.managerFeeBps()).to.equal(50);
    expect(await vault.keeperBps()).to.equal(100);
    expect(await vault.keeperEscrow()).to.equal(await km.getAddress());
    expect(await f.vaultCount()).to.equal(1);
  });

  it("predictRegistryIndexAddress matches the deployed address", async () => {
    const { f, owner, idx, unitSize, root } = await loadFixture(deploy);
    const predicted = await f.predictRegistryIndexAddress(owner.address, unitSize, root, ethers.ZeroHash);
    const actual = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
    expect(predicted).to.equal(actual);
  });
});
