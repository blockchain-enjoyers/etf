import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

async function deploy() {
  const [deployer, manager, meridian, treasury, alice] = await ethers.getSigners();
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  let [c0, c1] = [a, b];
  if (BigInt(t0) > BigInt(t1)) { [t0, t1] = [t1, t0]; [c0, c1] = [c1, c0]; }
  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;

  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);
  const Impl = await ethers.getContractFactory("ManagedRebalanceVault");
  const impl = await Impl.deploy();
  const commitment = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]", "uint256"], [tokens, unitQty, unitSize])
  );
  const args = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "bytes32"], [unitSize, commitment]);
  const Helper = await ethers.getContractFactory("CloneWithArgsHelper");
  const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), args);
  const vault = await ethers.getContractAt("ManagedRebalanceVault", await helper.lastClone());
  await vault.initializeRebalance(tokens, unitQty, "RB", "RB", {
    manager: manager.address, meridian: meridian.address, treasury: treasury.address,
    managerFeeBps: 0, platformFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress(),
    feeToken: ethers.ZeroAddress, flatCreateFee: 0n, flatRedeemFee: 0n,
  });

  async function fund(who: any, amtA: bigint, amtB: bigint) {
    await c0.mint(who.address, amtA); await c1.mint(who.address, amtB);
    await c0.connect(who).approve(await vault.getAddress(), amtA);
    await c1.connect(who).approve(await vault.getAddress(), amtB);
  }
  return { vault, c0, c1, tokens, deployer, alice, fund };
}

describe("ManagedRebalanceVault — holdings-based create/redeem", () => {
  it("bootstrap create (supply==0) pulls the target recipe and seeds the custody set", async () => {
    const { vault, c0, c1, deployer, fund } = await loadFixture(deploy);
    await fund(deployer, 2n * ONE, 3n * ONE);
    await vault.create(ONE);
    expect(await vault.totalSupply()).to.equal(ONE);
    expect(await c0.balanceOf(await vault.getAddress())).to.equal(2n * ONE);
    expect(await c1.balanceOf(await vault.getAddress())).to.equal(3n * ONE);
    const held = await vault.heldTokens();
    expect(held.length).to.equal(2);
  });

  it("subsequent create is pro-rata over CURRENT holdings, rounding up", async () => {
    const { vault, c0, c1, deployer, alice, fund } = await loadFixture(deploy);
    await fund(deployer, 2n * ONE, 3n * ONE);
    await vault.create(ONE);
    await fund(alice, 1n * ONE, 2n * ONE);
    await vault.connect(alice).create(ONE / 2n);
    expect(await vault.balanceOf(alice.address)).to.equal(ONE / 2n);
    expect(await c0.balanceOf(await vault.getAddress())).to.equal(3n * ONE);
    expect(await c1.balanceOf(await vault.getAddress())).to.equal(45n * ONE / 10n);
  });

  it("redeem pays pro-rata over current holdings, rounding down; redeem never reverts on a normal token", async () => {
    const { vault, c0, c1, deployer, fund } = await loadFixture(deploy);
    await fund(deployer, 2n * ONE, 3n * ONE);
    await vault.create(ONE);
    await vault.redeem(ONE / 2n);
    expect(await vault.totalSupply()).to.equal(ONE / 2n);
    expect(await c0.balanceOf(await vault.getAddress())).to.equal(ONE);
    expect(await c1.balanceOf(await vault.getAddress())).to.equal(15n * ONE / 10n);
  });

  it("createWithPermit is disabled on this flavor", async () => {
    const { vault } = await loadFixture(deploy);
    await expect(vault.createWithPermit(ONE, [])).to.be.revertedWithCustomError(vault, "UseCreate");
  });
});
