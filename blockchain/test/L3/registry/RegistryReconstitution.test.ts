import { expect } from "chai";
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"];

async function deploy() {
  const [deployer, manager, other] = await ethers.getSigners();
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  if (BigInt(t0) > BigInt(t1)) [t0, t1] = [t1, t0];
  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;

  const genesis = StandardMerkleTree.of(tokens.map((t, i) => [t, unitQty[i].toString(), unitSize.toString()]), ENC).root;
  // a different (reweighted) target -> a NEW root for reconstitution
  const newQty = [4n * ONE, 1n * ONE];
  const newRoot = StandardMerkleTree.of(tokens.map((t, i) => [t, newQty[i].toString(), unitSize.toString()]), ENC).root;

  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);
  const Bv = await ethers.getContractFactory("BasketVault"); const bImpl = await Bv.deploy();
  const Mv = await ethers.getContractFactory("ManagedVault"); const mImpl = await Mv.deploy();
  const Cv = await ethers.getContractFactory("CommittedVault"); const cImpl = await Cv.deploy();
  const Rrv = await ethers.getContractFactory("RegistryRebalanceVault"); const rrImpl = await Rrv.deploy();
  const F = await ethers.getContractFactory("CloneFactory");
  const f = await F.deploy(await bImpl.getAddress(), await mImpl.getAddress(), await cImpl.getAddress());
  await f.setRegistryRebalanceImpl(await rrImpl.getAddress());
  await f.setConstituentAllowed(t0, true); await f.setConstituentAllowed(t1, true);

  const idx = { genesisRoot: genesis, tokens, unitSize, name: "X", symbol: "X",
    manager: manager.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress() };
  const vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
  await f.createRegistryIndex(idx, ethers.ZeroHash);
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);

  return { vault, manager, other, tokens, unitQty, newQty, newRoot, unitSize, genesis };
}

describe("RegistryRebalanceVault — reconstitution (RootCommitment)", () => {
  it("manager schedules a new root, timelock elapses, activateRoot flips recipeRoot", async () => {
    const { vault, manager, tokens, newQty, newRoot, unitSize } = await deploy();
    await expect(vault.connect(manager).scheduleRoot(newRoot, tokens, newQty, unitSize))
      .to.emit(vault, "RootScheduled");
    expect(await vault.pendingRoot()).to.equal(newRoot);

    await expect(vault.connect(manager).activateRoot()).to.be.revertedWithCustomError(vault, "RootTimelockNotElapsed");
    await time.increase(7 * 24 * 3600);
    await expect(vault.connect(manager).activateRoot()).to.emit(vault, "RootActivated").withArgs(newRoot);
    expect(await vault.recipeRoot()).to.equal(newRoot);
    expect(await vault.pendingRoot()).to.equal(ethers.ZeroHash);
  });

  it("a non-manager scheduleRoot reverts NotManager (the curator gate)", async () => {
    const { vault, other, tokens, newQty, newRoot, unitSize } = await deploy();
    await expect(vault.connect(other).scheduleRoot(newRoot, tokens, newQty, unitSize))
      .to.be.revertedWithCustomError(vault, "NotManager");
  });

  it("RootScheduled emits the FULL recipe (data availability)", async () => {
    const { vault, manager, tokens, newQty, newRoot, unitSize } = await deploy();
    const tx = await vault.connect(manager).scheduleRoot(newRoot, tokens, newQty, unitSize);
    const rc = await tx.wait();
    const ev = rc!.logs.map((l: any) => { try { return vault.interface.parseLog(l); } catch { return null; } })
      .find((p: any) => p && p.name === "RootScheduled");
    expect(ev).to.not.equal(undefined);
    expect(ev!.args.newRoot).to.equal(newRoot);
    expect(ev!.args.tokens).to.deep.equal(tokens);
    expect(ev!.args.unitQty.map((x: bigint) => x)).to.deep.equal(newQty);
    expect(ev!.args.unitSize).to.equal(unitSize);
  });
});
