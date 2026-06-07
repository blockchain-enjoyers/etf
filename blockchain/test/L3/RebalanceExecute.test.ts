import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

async function deploy() {
  const [deployer, manager, meridian, treasury, bidder] = await ethers.getSigners();
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A","A",18); const b = await Tok.deploy("B","B",18); const c = await Tok.deploy("C","C",18);
  let pairs = [[await a.getAddress(), a],[await b.getAddress(), b]].sort((x,y)=> BigInt(x[0] as string) < BigInt(y[0] as string) ? -1 : 1);
  const tokens = pairs.map(p=>p[0] as string); const unitQty=[10n*ONE,10n*ONE], unitSize=ONE;
  const cAddr = await c.getAddress();

  const Km = await ethers.getContractFactory("KeeperModule"); const km = await Km.deploy(deployer.address);
  const Impl = await ethers.getContractFactory("ManagedRebalanceVault"); const impl = await Impl.deploy();
  const commitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address[]","uint256[]","uint256"],[tokens,unitQty,unitSize]));
  const argz = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","bytes32"],[unitSize,commitment]);
  const Helper = await ethers.getContractFactory("CloneWithArgsHelper"); const helper = await Helper.deploy();
  await helper.clone(await impl.getAddress(), argz);
  const vault = await ethers.getContractAt("ManagedRebalanceVault", await helper.lastClone());
  await vault.initializeRebalance(tokens, unitQty, "RB","RB", { manager: manager.address, meridian: meridian.address, treasury: treasury.address, managerFeeBps:0, platformShareBps:0, keeperBps:0, keeperEscrow: await km.getAddress() });

  // bootstrap: deposit 10 A + 10 B for 1 share
  const [tA, tB] = tokens;
  const cA = pairs.find(p=>p[0]===tA)![1] as any; const cB = pairs.find(p=>p[0]===tB)![1] as any;
  await cA.mint(deployer.address, 10n*ONE); await cB.mint(deployer.address, 10n*ONE);
  await cA.approve(await vault.getAddress(), 10n*ONE); await cB.approve(await vault.getAddress(), 10n*ONE);
  await vault.create(ONE);

  // register a mock executor as the gate
  const Exec = await ethers.getContractFactory("MockRebalanceExecutor");
  const exec = await Exec.deploy(await vault.getAddress());
  await vault.connect(meridian).setExecutor(await exec.getAddress(), true);

  return { vault, exec, bidder, manager, meridian, tokens, cAddr, c, a, b, pairs };
}

describe("ManagedRebalanceVault — executeRebalance", () => {
  it("only a registered executor may call executeRebalance", async () => {
    const { vault, tokens } = await loadFixture(deploy);
    const [, , , , rando] = await ethers.getSigners();
    await expect(vault.connect(rando).executeRebalance(
      [tokens[0]], [ONE], [tokens[1]], [ONE], [ONE], rando.address
    )).to.be.revertedWithCustomError(vault, "NotExecutor");
  });

  it("atomic swap: bidder delivers acquire-legs IN, vault sends release-legs OUT, all-or-nothing", async () => {
    const { vault, exec, bidder, tokens, cAddr, c, pairs } = await loadFixture(deploy);
    const [tA, tB] = tokens;
    const cA = pairs.find(p=>p[0]===tA)![1] as any;
    await c.mint(bidder.address, 4n*ONE);
    await c.connect(bidder).approve(await exec.getAddress(), 4n*ONE);
    await exec.connect(bidder).bidSwap(
      [cAddr], [4n*ONE],
      [tA], [4n*ONE],
      [4n*ONE],
      bidder.address
    );
    expect(await cA.balanceOf(await vault.getAddress())).to.equal(6n*ONE);
    expect(await c.balanceOf(await vault.getAddress())).to.equal(4n*ONE);
    const held = await vault.heldTokens();
    expect(held.length).to.equal(3);
  });

  it("reverts the whole swap if a release leg would underflow minOut backing (per-leg minOut)", async () => {
    const { vault, exec, bidder, tokens, cAddr, c } = await loadFixture(deploy);
    const [tA] = tokens;
    await c.mint(bidder.address, 1n*ONE);
    await c.connect(bidder).approve(await exec.getAddress(), 1n*ONE);
    await expect(exec.connect(bidder).bidSwap([cAddr],[1n*ONE],[tA],[8n*ONE],[5n*ONE],bidder.address))
      .to.be.revertedWithCustomError(vault, "MinOutNotMet");
  });
});
