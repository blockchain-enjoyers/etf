import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

async function deployWithFee(managerFeeBps: number, platformShareBps: number, keeperBps: number) {
  const [deployer, manager, meridian, treasury] = await ethers.getSigners();
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A","A",18); const b = await Tok.deploy("B","B",18);
  let pairs = [[await a.getAddress(),a],[await b.getAddress(),b]].sort((x,y)=>BigInt(x[0] as string)<BigInt(y[0] as string)?-1:1);
  const tokens = pairs.map(p=>p[0] as string); const unitQty=[2n*ONE,3n*ONE], unitSize=ONE;
  const cA = pairs[0][1] as any, cB = pairs[1][1] as any;

  const Km = await ethers.getContractFactory("KeeperModule"); const km = await Km.deploy(deployer.address);
  const Impl = await ethers.getContractFactory("ManagedRebalanceVault"); const impl = await Impl.deploy();
  const commitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address[]","uint256[]","uint256"],[tokens,unitQty,unitSize]));
  const argz = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","bytes32"],[unitSize,commitment]);
  const Helper = await ethers.getContractFactory("CloneWithArgsHelper"); const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), argz);
  const vault = await ethers.getContractAt("ManagedRebalanceVault", await helper.lastClone());
  await vault.initializeRebalance(tokens, unitQty, "RB","RB", { manager: manager.address, meridian: meridian.address, treasury: treasury.address, managerFeeBps, platformShareBps, keeperBps, keeperEscrow: await km.getAddress() });
  return { vault, cA, cB, tokens, deployer };
}

async function deploy() {
  return deployWithFee(0, 0, 0);
}

async function deployFeeBearing() {
  // managerFeeBps=100 (1%/yr), platform+keeper non-zero too so all three legs accrue.
  return deployWithFee(100, 1000, 1000);
}

describe("ManagedRebalanceVault — holdings-based previews", () => {
  it("previewCreate at supply==0 returns the target-recipe bootstrap quantities", async () => {
    const { vault } = await loadFixture(deploy);
    const [tk, amts] = await vault.previewCreate(ONE); // 1 unit
    expect(tk.length).to.equal(2);
    expect(amts[0]).to.equal(2n*ONE);
    expect(amts[1]).to.equal(3n*ONE);
  });

  it("previewCreate after bootstrap quotes ceil over current holdings and matches what create pulls", async () => {
    const { vault, cA, cB, deployer } = await loadFixture(deploy);
    await cA.mint(deployer.address, 2n*ONE); await cB.mint(deployer.address, 3n*ONE);
    await cA.approve(await vault.getAddress(), 2n*ONE); await cB.approve(await vault.getAddress(), 3n*ONE);
    await vault.create(ONE);
    const [, amts] = await vault.previewCreate(ONE/2n);
    expect(amts[0]).to.equal(1n*ONE);
    expect(amts[1]).to.equal(15n*ONE/10n);
    await cA.mint(deployer.address, amts[0]); await cB.mint(deployer.address, amts[1]);
    await cA.approve(await vault.getAddress(), amts[0]); await cB.approve(await vault.getAddress(), amts[1]);
    await vault.create(ONE/2n);
    expect(await vault.balanceOf(deployer.address)).to.equal(ONE + ONE/2n);
  });

  it("previewRedeem quotes floor over holdings; reverts at supply==0", async () => {
    const { vault, cA, cB, deployer } = await loadFixture(deploy);
    await cA.mint(deployer.address, 2n*ONE); await cB.mint(deployer.address, 3n*ONE);
    await cA.approve(await vault.getAddress(), 2n*ONE); await cB.approve(await vault.getAddress(), 3n*ONE);
    await vault.create(ONE);
    const [, amts] = await vault.previewRedeem(ONE/2n);
    expect(amts[0]).to.equal(1n*ONE);
    expect(amts[1]).to.equal(15n*ONE/10n);
    const fresh = await loadFixture(deploy);
    await expect(fresh.vault.previewRedeem(ONE)).to.be.revertedWithCustomError(fresh.vault, "NoSupply");
  });

  it("previews stay wei-exact vs create/redeem with a non-zero fee and pending accrual", async () => {
    const { vault, cA, cB, deployer } = await loadFixture(deployFeeBearing);
    // bootstrap one unit
    await cA.mint(deployer.address, 2n*ONE); await cB.mint(deployer.address, 3n*ONE);
    await cA.approve(await vault.getAddress(), 2n*ONE); await cB.approve(await vault.getAddress(), 3n*ONE);
    await vault.create(ONE);

    // let a long window elapse so the fee mints are material (changes totalSupply, not balanceOf)
    await time.increase(120 * 24 * 60 * 60); // 120 days

    // sanity: there IS pending fee dilution to account for
    expect(await vault.pendingMintShares()).to.be.greaterThan(0n);

    const vaultAddr = await vault.getAddress();

    // To compare the VIEW preview against the TX execution wei-for-wei, both must see the SAME
    // block.timestamp. We mint+approve a generous buffer first (those mine blocks), then PIN the next
    // block timestamp T; previewCreate is read against the PENDING block (== T) and create then lands
    // in a block at exactly T, so _accrue and pendingMintShares() see an identical elapsed window.

    // ---- previewCreate must equal exactly what create pulls ----
    // Over-mint/approve a buffer so allowance never gates; we assert the EXACT pulled delta below.
    await cA.mint(deployer.address, 10n*ONE); await cB.mint(deployer.address, 10n*ONE);
    await cA.approve(vaultAddr, 10n*ONE); await cB.approve(vaultAddr, 10n*ONE);

    const tCreate = (await time.latest()) + 7 * 24 * 60 * 60;
    await time.setNextBlockTimestamp(tCreate);
    const [, cAmts] = await vault.previewCreate.staticCall(ONE/2n, { blockTag: "pending" });

    const aBefore = await cA.balanceOf(deployer.address);
    const bBefore = await cB.balanceOf(deployer.address);
    const sharesBefore = await vault.balanceOf(deployer.address);
    await vault.create(ONE/2n); // mined at tCreate (the pinned next-block timestamp)
    // create succeeded; deployer minted exactly nShares and the previewed legs were pulled to the wei
    expect(await vault.balanceOf(deployer.address)).to.equal(sharesBefore + ONE/2n);
    expect(aBefore - (await cA.balanceOf(deployer.address))).to.equal(cAmts[0]);
    expect(bBefore - (await cB.balanceOf(deployer.address))).to.equal(cAmts[1]);

    // ---- previewRedeem must equal exactly what redeem pays out ----
    const tRedeem = (await time.latest()) + 7 * 24 * 60 * 60;
    await time.setNextBlockTimestamp(tRedeem);
    const [, rAmts] = await vault.previewRedeem.staticCall(ONE/2n, { blockTag: "pending" });
    const aPre = await cA.balanceOf(deployer.address);
    const bPre = await cB.balanceOf(deployer.address);
    await vault.redeem(ONE/2n); // mined at tRedeem
    expect((await cA.balanceOf(deployer.address)) - aPre).to.equal(rAmts[0]);
    expect((await cB.balanceOf(deployer.address)) - bPre).to.equal(rAmts[1]);
  });

  it("previewCreate at supply==0 reverts NonMultipleOfUnitSize for a non-unit-multiple nShares", async () => {
    const { vault } = await loadFixture(deploy); // fresh, unbootstrapped (supply==0)
    // unitSize == ONE, so nShares not a whole multiple of ONE must revert on the bootstrap branch.
    await expect(vault.previewCreate(ONE + 1n)).to.be.revertedWithCustomError(vault, "NonMultipleOfUnitSize");
    await expect(vault.previewCreate(1n)).to.be.revertedWithCustomError(vault, "NonMultipleOfUnitSize");
  });

  it("previewCreate rounds the create draw UP (ceil) on an inexact division, wei-exact vs create", async () => {
    const { vault, cA, cB, deployer } = await loadFixture(deploy);
    const vaultAddr = await vault.getAddress();
    // bootstrap: supply == ONE, holdings A == 2*ONE, B == 3*ONE
    await cA.mint(deployer.address, 2n*ONE); await cB.mint(deployer.address, 3n*ONE);
    await cA.approve(vaultAddr, 2n*ONE); await cB.approve(vaultAddr, 3n*ONE);
    await vault.create(ONE);

    // donate 1 wei of A directly to the vault -> balanceOf(A) == 2*ONE + 1, an INEXACT multiple of supply.
    await cA.mint(deployer.address, 1n);
    await cA.transfer(vaultAddr, 1n);
    expect(await cA.balanceOf(vaultAddr)).to.equal(2n*ONE + 1n);

    // previewCreate(1 wei): A draw = ceil((2*ONE+1)*1 / ONE) = 3 (floor would be 2 -> ceil adds 1 wei).
    //                       B draw = ceil(3*ONE*1 / ONE)     = 3 (divides evenly).
    const [, amts] = await vault.previewCreate(1n);
    expect(amts[0]).to.equal(3n); // CEIL rounded the fractional A draw UP by 1 wei
    expect(amts[1]).to.equal(3n);

    // create with exactly the previewed amounts succeeds and pulls EXACTLY those amounts (wei-exact).
    await cA.mint(deployer.address, amts[0]); await cB.mint(deployer.address, amts[1]);
    await cA.approve(vaultAddr, amts[0]); await cB.approve(vaultAddr, amts[1]);
    const aBefore = await cA.balanceOf(deployer.address);
    const bBefore = await cB.balanceOf(deployer.address);
    const sharesBefore = await vault.balanceOf(deployer.address);
    await vault.create(1n);
    expect(await vault.balanceOf(deployer.address)).to.equal(sharesBefore + 1n);
    expect(aBefore - (await cA.balanceOf(deployer.address))).to.equal(amts[0]); // exactly the ceil value
    expect(bBefore - (await cB.balanceOf(deployer.address))).to.equal(amts[1]);
    expect(await cA.allowance(deployer.address, vaultAddr)).to.equal(0n); // no shortfall, no residual
    expect(await cB.allowance(deployer.address, vaultAddr)).to.equal(0n);
  });
});
