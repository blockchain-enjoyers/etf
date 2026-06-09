import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const EXEC = { MANAGER_ONLY: 0, ALLOWLIST: 1, PERMISSIONLESS: 2 };

async function deploy() {
  const [deployer, manager, meridian, treasury, keeper, bidder] = await ethers.getSigners();
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A","A",18); const b = await Tok.deploy("B","B",18); const c = await Tok.deploy("C","C",18);
  let pairs = [[await a.getAddress(),a],[await b.getAddress(),b]].sort((x,y)=>BigInt(x[0] as string)<BigInt(y[0] as string)?-1:1);
  const tokens = pairs.map(p=>p[0] as string); const unitQty=[10n*ONE,10n*ONE], unitSize=ONE; const cAddr = await c.getAddress();
  const Km = await ethers.getContractFactory("KeeperModule"); const km = await Km.deploy(deployer.address);
  const Impl = await ethers.getContractFactory("ManagedRebalanceVault"); const impl = await Impl.deploy();
  const commitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address[]","uint256[]","uint256"],[tokens,unitQty,unitSize]));
  const argz = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","bytes32"],[unitSize,commitment]);
  const Helper = await ethers.getContractFactory("CloneWithArgsHelper"); const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), argz);
  const vault = await ethers.getContractAt("ManagedRebalanceVault", await helper.lastClone());
  await vault.initializeRebalance(tokens, unitQty, "RB","RB", { manager: manager.address, meridian: meridian.address, treasury: treasury.address, managerFeeBps:200, platformFeeBps:15, keeperBps:250, keeperEscrow: await km.getAddress() });
  const [tA, tB] = tokens; const cA = pairs.find(p=>p[0]===tA)![1] as any; const cB = pairs.find(p=>p[0]===tB)![1] as any;
  await cA.mint(deployer.address, 10n*ONE); await cB.mint(deployer.address, 10n*ONE);
  await cA.approve(await vault.getAddress(), 10n*ONE); await cB.approve(await vault.getAddress(), 10n*ONE);
  await vault.create(ONE);
  await time.increase(365*24*3600); await vault.accrueFee();

  const Auc = await ethers.getContractFactory("RebalanceAuction");
  const auc = await Auc.deploy(await km.getAddress(), 5n * 10n**15n); // maxTip 0.005 share
  await vault.connect(meridian).setExecutor(await auc.getAddress(), true);
  await km.connect(deployer).setExecutor(await auc.getAddress(), true);
  await km.connect(deployer).setMaxRewardPerCall(ONE);
  await auc.connect(manager).setExecMode(await vault.getAddress(), EXEC.MANAGER_ONLY);

  return { vault, auc, km, manager, keeper, bidder, tokens, cAddr, c, pairs };
}

describe("RebalanceAuction", () => {
  it("MANAGER_ONLY: a non-manager cannot open", async () => {
    const { auc, vault, tokens, cAddr, bidder } = await loadFixture(deploy);
    const [tA] = tokens;
    await expect(auc.connect(bidder).open(await vault.getAddress(), [tA],[4n*ONE],[cAddr],[5n*ONE],[4n*ONE],100))
      .to.be.revertedWithCustomError(auc, "NotAllowedToOpen");
  });

  it("opens, a bidder fills the delta, keeper (opener) is paid a clamped tip from escrow", async () => {
    const { auc, vault, km, manager, tokens, cAddr, c, pairs } = await loadFixture(deploy);
    const [tA] = tokens; const cA = pairs.find(p=>p[0]===tA)![1] as any;
    const share = await vault.getAddress();
    await auc.connect(manager).open(share, [tA],[4n*ONE],[cAddr],[5n*ONE],[4n*ONE],100);
    const bidder = (await ethers.getSigners())[5];
    await c.mint(bidder.address, 5n*ONE);
    await c.connect(bidder).approve(await auc.getAddress(), 5n*ONE);
    const escrowBefore = await km.escrowOf(share);
    await auc.connect(bidder).bid(share);
    expect(await cA.balanceOf(share)).to.equal(6n*ONE);
    expect(await c.balanceOf(share)).to.be.greaterThanOrEqual(4n*ONE);
    expect(await km.escrowOf(share)).to.be.lessThan(escrowBefore);
  });

  it("a second bid on a filled auction reverts NoActiveAuction", async () => {
    const { auc, vault, manager, tokens, cAddr, c } = await loadFixture(deploy);
    const [tA] = tokens; const share = await vault.getAddress();
    await auc.connect(manager).open(share, [tA],[4n*ONE],[cAddr],[5n*ONE],[4n*ONE],100);
    const bidder = (await ethers.getSigners())[5];
    await c.mint(bidder.address, 5n*ONE); await c.connect(bidder).approve(await auc.getAddress(), 5n*ONE);
    await auc.connect(bidder).bid(share);
    await expect(auc.connect(bidder).bid(share)).to.be.revertedWithCustomError(auc, "NoActiveAuction");
  });

  it("rejects duration 0, startIn<endIn, and a token on both sides", async () => {
    const { auc, vault, manager, tokens, cAddr } = await loadFixture(deploy);
    const [tA] = tokens; const share = await vault.getAddress();
    await expect(auc.connect(manager).open(share, [tA],[4n*ONE],[cAddr],[5n*ONE],[4n*ONE],0))
      .to.be.revertedWithCustomError(auc, "InvalidAuctionParams"); // duration 0
    await expect(auc.connect(manager).open(share, [tA],[4n*ONE],[cAddr],[3n*ONE],[4n*ONE],100))
      .to.be.revertedWithCustomError(auc, "InvalidAuctionParams"); // startIn < endIn
    await expect(auc.connect(manager).open(share, [tA],[4n*ONE],[tA],[5n*ONE],[4n*ONE],100))
      .to.be.revertedWithCustomError(auc, "InvalidAuctionParams"); // same token both sides
  });

  it("bid reverts after the auction expires", async () => {
    const { auc, vault, manager, tokens, cAddr, c } = await loadFixture(deploy);
    const [tA] = tokens; const share = await vault.getAddress();
    await auc.connect(manager).open(share, [tA],[4n*ONE],[cAddr],[5n*ONE],[4n*ONE],100);
    await time.increase(101);
    const bidder = (await ethers.getSigners())[5];
    await c.mint(bidder.address, 5n*ONE); await c.connect(bidder).approve(await auc.getAddress(), 5n*ONE);
    await expect(auc.connect(bidder).bid(share)).to.be.revertedWithCustomError(auc, "AuctionExpired");
  });
});
