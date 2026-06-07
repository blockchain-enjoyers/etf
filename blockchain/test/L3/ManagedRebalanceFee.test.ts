import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const YEAR = 365 * 24 * 3600;

async function deploy(keeperBps: number) {
  const [deployer, manager, meridian, treasury] = await ethers.getSigners();

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  if (BigInt(t0) > BigInt(t1)) [t0, t1] = [t1, t0];
  const tokens = [t0, t1];
  const unitQty = [1n * ONE, 1n * ONE];
  const unitSize = ONE;

  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);

  const Impl = await ethers.getContractFactory("ManagedRebalanceVault");
  const impl = await Impl.deploy();
  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]", "uint256"], [tokens, unitQty, unitSize])
  );
  const args = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [unitSize, commitment]);
  const CloneHelper = await ethers.getContractFactory("CloneWithArgsHelper");
  const helper = await CloneHelper.deploy();
  const tx = await helper.clone(await impl.getAddress(), args);
  const rc = await tx.wait();
  const cloneAddr = (await helper.lastClone());
  const vault = await ethers.getContractAt("ManagedRebalanceVault", cloneAddr);

  await vault.initializeRebalance(tokens, unitQty, "RB", "RB", {
    manager: manager.address, meridian: meridian.address, treasury: treasury.address,
    managerFeeBps: 200, platformShareBps: 1000, keeperBps, keeperEscrow: await km.getAddress(),
  });

  await a.mint(deployer.address, ONE); await b.mint(deployer.address, ONE);
  await a.approve(cloneAddr, ONE); await b.approve(cloneAddr, ONE);
  await vault.create(ONE); // nShares (holdings-based override): 1e18 shares = 1 unitSize

  return { vault, km, tokens, manager, meridian, treasury, share: cloneAddr };
}

// Named fixtures (loadFixture rejects anonymous arrows — must be stable references).
const deploy0 = () => deploy(0);
const deploy250 = () => deploy(250);

describe("ManagedRebalanceVault — 3-way fee", () => {
  it("with keeperBps=0 behaves like ManagedVault (no keeper escrow growth)", async () => {
    const { vault, km, share } = await loadFixture(deploy0);
    await time.increase(YEAR);
    await vault.accrueFee();
    expect(await km.escrowOf(share)).to.equal(0n);
  });

  it("with keeperBps>0 the escrow accrues keeper shares from the fee", async () => {
    const { vault, km, share } = await loadFixture(deploy250);
    await time.increase(YEAR);
    await vault.accrueFee();
    expect(await km.escrowOf(share)).to.be.greaterThan(0n);
  });

  it("the three legs sum to the total fee minted (manager + platform + keeper)", async () => {
    const { vault, km, share, manager, treasury } = await loadFixture(deploy250);
    const supplyBefore = await vault.totalSupply();
    await time.increase(YEAR);
    await vault.accrueFee();
    const minted = (await vault.totalSupply()) - supplyBefore;
    const legs =
      (await vault.balanceOf(manager.address)) +
      (await vault.balanceOf(treasury.address)) +
      (await km.escrowOf(share));
    expect(legs).to.equal(minted);
  });

  it("rejects keeperBps over KEEPER_MAX and a zero escrow when keeperBps>0", async () => {
    const [deployer, manager, meridian, treasury] = await ethers.getSigners();
    const Tok = await ethers.getContractFactory("MockERC20Decimals");
    const a = await Tok.deploy("A", "A", 18);
    const b = await Tok.deploy("B", "B", 18);
    let [t0, t1] = [await a.getAddress(), await b.getAddress()];
    if (BigInt(t0) > BigInt(t1)) [t0, t1] = [t1, t0];
    const tokens = [t0, t1];
    const unitQty = [1n * ONE, 1n * ONE];
    const unitSize = ONE;
    const Impl = await ethers.getContractFactory("ManagedRebalanceVault");
    const impl = await Impl.deploy();
    expect(await impl.KEEPER_MAX()).to.equal(2000);

    const commitment = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]", "uint256"], [tokens, unitQty, unitSize])
    );
    const args = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [unitSize, commitment]);
    const Helper = await ethers.getContractFactory("CloneWithArgsHelper");

    // keeperBps over KEEPER_MAX -> KeeperShareTooHigh
    const h1 = await Helper.deploy();
    await h1.clone(await impl.getAddress(), args);
    const v1 = await ethers.getContractAt("ManagedRebalanceVault", await h1.lastClone());
    await expect(v1.initializeRebalance(tokens, unitQty, "RB", "RB", {
      manager: manager.address, meridian: meridian.address, treasury: treasury.address,
      managerFeeBps: 200, platformShareBps: 1000, keeperBps: 2001, keeperEscrow: deployer.address,
    })).to.be.revertedWithCustomError(impl, "KeeperShareTooHigh");

    // keeperBps>0 with zero escrow -> ZeroEscrow
    const h2 = await Helper.deploy();
    await h2.clone(await impl.getAddress(), args);
    const v2 = await ethers.getContractAt("ManagedRebalanceVault", await h2.lastClone());
    await expect(v2.initializeRebalance(tokens, unitQty, "RB", "RB", {
      manager: manager.address, meridian: meridian.address, treasury: treasury.address,
      managerFeeBps: 200, platformShareBps: 1000, keeperBps: 250, keeperEscrow: ethers.ZeroAddress,
    })).to.be.revertedWithCustomError(impl, "ZeroEscrow");
  });

  const WEEK = 7 * 24 * 3600;

  it("setKeeperBps lower-or-equal applies instantly", async () => {
    const { vault, meridian } = await loadFixture(deploy250);
    await vault.connect(meridian).setKeeperBps(100);
    expect(await vault.keeperBps()).to.equal(100);
    expect(await vault.keeperBpsEffectiveAt()).to.equal(0);
  });

  it("setKeeperBps higher is timelocked, then activates after the week", async () => {
    const { vault, meridian } = await loadFixture(deploy250);
    await vault.connect(meridian).setKeeperBps(500);
    expect(await vault.keeperBps()).to.equal(250); // unchanged until activation
    expect(await vault.keeperBpsEffectiveAt()).to.be.greaterThan(0n);
    await expect(vault.connect(meridian).activateKeeperBps())
      .to.be.revertedWithCustomError(vault, "TimelockNotElapsed");
    await time.increase(WEEK);
    await vault.connect(meridian).activateKeeperBps();
    expect(await vault.keeperBps()).to.equal(500);
    expect(await vault.keeperBpsEffectiveAt()).to.equal(0);
  });

  it("activateKeeperBps with nothing pending reverts", async () => {
    const { vault, meridian } = await loadFixture(deploy250);
    await expect(vault.connect(meridian).activateKeeperBps())
      .to.be.revertedWithCustomError(vault, "NothingPending");
  });

  it("only meridian can set keeperBps", async () => {
    const { vault } = await loadFixture(deploy250);
    const [, , , , other] = await ethers.getSigners();
    await expect(vault.connect(other).setKeeperBps(100))
      .to.be.revertedWithCustomError(vault, "NotMeridian");
  });
});
