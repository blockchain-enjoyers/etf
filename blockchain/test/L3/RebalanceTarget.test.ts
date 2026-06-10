import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const WEEK = 7 * 24 * 3600;

async function deploy() {
  const [deployer, manager, meridian, treasury] = await ethers.getSigners();
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A","A",18); const b = await Tok.deploy("B","B",18);
  let [t0,t1] = [await a.getAddress(), await b.getAddress()];
  if (BigInt(t0) > BigInt(t1)) [t0,t1] = [t1,t0];
  const tokens=[t0,t1], unitQty=[2n*ONE,3n*ONE], unitSize=ONE;
  const Km = await ethers.getContractFactory("KeeperModule"); const km = await Km.deploy(deployer.address);
  const Impl = await ethers.getContractFactory("ManagedRebalanceVault"); const impl = await Impl.deploy();
  const commitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address[]","uint256[]","uint256"],[tokens,unitQty,unitSize]));
  const argz = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","bytes32"],[unitSize,commitment]);
  const Helper = await ethers.getContractFactory("CloneWithArgsHelper"); const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), argz);
  const vault = await ethers.getContractAt("ManagedRebalanceVault", await helper.lastClone());
  await vault.initializeRebalance(tokens, unitQty, "RB","RB", { manager: manager.address, meridian: meridian.address, treasury: treasury.address, managerFeeBps:0, platformFeeBps: 0, keeperBps:0, keeperEscrow: await km.getAddress(), feeToken: ethers.ZeroAddress, flatCreateFee: 0n, flatRedeemFee: 0n });
  return { vault, manager, tokens, unitQty };
}

describe("ManagedRebalanceVault — target setters", () => {
  it("only the manager can schedule a target change", async () => {
    const { vault, tokens, unitQty } = await loadFixture(deploy);
    const [, , , , other] = await ethers.getSigners();
    await expect(vault.connect(other).scheduleTarget(tokens, unitQty))
      .to.be.revertedWithCustomError(vault, "NotManager");
  });

  it("a scheduled target activates only after the timelock and replaces the target", async () => {
    const { vault, manager, tokens } = await loadFixture(deploy);
    const newQty = [1n * ONE, 4n * ONE]; // reweight, same constituents
    await vault.connect(manager).scheduleTarget(tokens, newQty);
    await expect(vault.connect(manager).activateTarget()).to.be.revertedWithCustomError(vault, "TimelockNotElapsed");
    await time.increase(WEEK);
    await vault.connect(manager).activateTarget();
    const [tk, q] = await vault.getConstituents();
    expect(q[0]).to.equal(1n * ONE);
    expect(q[1]).to.equal(4n * ONE);
    expect(tk.length).to.equal(2);
  });
});
