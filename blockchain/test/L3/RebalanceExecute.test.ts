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
  await vault.initializeRebalance(tokens, unitQty, "RB","RB", { manager: manager.address, meridian: meridian.address, treasury: treasury.address, managerFeeBps:0, platformFeeBps: 0, keeperBps:0, keeperEscrow: await km.getAddress() });

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

  // ---- FIX 1: disjoint-leg + recipient guards (defense-in-depth core hardening) ----

  it("overlap-drain on the SAME token both sides reverts OverlappingLeg (before any transfer)", async () => {
    const { vault, exec, bidder, tokens, pairs } = await loadFixture(deploy);
    const [tA] = tokens;
    const cA = pairs.find(p=>p[0]===tA)![1] as any;
    // bidder funds + approves 100 A to the mock executor (which has NO disjoint guard — the bypass vector)
    await cA.mint(bidder.address, 100n*ONE);
    await cA.connect(bidder).approve(await exec.getAddress(), 100n*ONE);
    // same token A on both sides: acquire 100 A, release 105 A, minOut 0 — would net-drain the vault A
    // pre-balance is 10 A; an overlap swap would move 105 out and 100 in => 5 A left.
    await expect(
      exec.connect(bidder).bidSwap([tA],[100n*ONE],[tA],[105n*ONE],[0n],bidder.address)
    ).to.be.revertedWithCustomError(vault, "OverlappingLeg");
    // vault A untouched (reverted before transfer)
    expect(await cA.balanceOf(await vault.getAddress())).to.equal(10n*ONE);
  });

  it("recipient == vault reverts InvalidRecipient", async () => {
    const { vault, meridian, tokens } = await loadFixture(deploy);
    const [, , , , , eoa] = await ethers.getSigners();
    const [tA] = tokens;
    await vault.connect(meridian).setExecutor(eoa.address, true);
    // empty acquire => no approval needed; release a tiny A leg to the vault itself
    await expect(
      vault.connect(eoa).executeRebalance([], [], [tA], [1n*ONE], [0n], await vault.getAddress())
    ).to.be.revertedWithCustomError(vault, "InvalidRecipient");
  });

  // ---- FIX 2: post-rebalance create/redeem composition (test only) ----

  it("post-rebalance prune + create(ceil)/redeem(floor)/last-share-drain compose correctly", async () => {
    const { vault, exec, bidder, tokens, cAddr, c, pairs } = await loadFixture(deploy);
    const [tA, tB] = tokens;
    const cA = pairs.find(p=>p[0]===tA)![1] as any;
    const cB = pairs.find(p=>p[0]===tB)![1] as any;
    const vAddr = await vault.getAddress();

    // 1. FULLY release A (10) and acquire ~7 C, minOut=[0] for the A leg so the prune path runs.
    //    Use 7e18 + 1 wei of C so holdings are NOT a clean multiple of supply (1e18) — this is what
    //    makes the redeem floor + create ceil genuinely round (non-vacuous remainder fixture).
    const cIn = 7n*ONE + 1n;
    await c.mint(bidder.address, cIn);
    await c.connect(bidder).approve(await exec.getAddress(), cIn);
    await exec.connect(bidder).bidSwap([cAddr],[cIn],[tA],[10n*ONE],[0n],bidder.address);

    // 2. heldTokens by SET MEMBERSHIP read dynamically (swap-pop reorders).
    let held = (await vault.heldTokens()).map((x: string) => x.toLowerCase());
    expect(held.length).to.equal(2);
    expect(held).to.not.include(tA.toLowerCase());
    expect(held).to.include(tB.toLowerCase());
    expect(held).to.include(cAddr.toLowerCase());
    expect(await cA.balanceOf(vAddr)).to.equal(0n);
    expect(await cB.balanceOf(vAddr)).to.equal(10n*ONE);
    expect(await c.balanceOf(vAddr)).to.equal(cIn);

    // supply == 1 share (ONE). Holdings: B=10e18, C=7e18+1.
    // 3. redeem a non-dividing fraction => floor, leaves dust.
    const supply0 = await vault.totalSupply(); // == ONE
    const redeemAmt = (ONE / 3n) + 1n; // 333...334 wei, does not divide evenly
    const balB0 = await cB.balanceOf(vAddr);
    const balC0 = await c.balanceOf(vAddr);
    const expB = balB0 * redeemAmt / supply0;
    const expC = balC0 * redeemAmt / supply0;
    // genuine remainder check (non-vacuous): the C multiplication is not exact (7e18+1 breaks it)
    expect(balC0 * redeemAmt % supply0).to.not.equal(0n);
    const redeemer = (await ethers.getSigners())[0]; // deployer holds the share
    const rB0 = await cB.balanceOf(redeemer.address);
    const rC0 = await c.balanceOf(redeemer.address);
    await vault.connect(redeemer).redeem(redeemAmt);
    expect((await cB.balanceOf(redeemer.address)) - rB0).to.equal(expB);
    expect((await c.balanceOf(redeemer.address)) - rC0).to.equal(expC);
    // floor leaves dust in the vault
    expect(await cB.balanceOf(vAddr)).to.equal(balB0 - expB);
    expect(await c.balanceOf(vAddr)).to.equal(balC0 - expC);

    // 4. create-after-rebalance by a fresh depositor, non-dividing nShares => ceil, pulls non-zero C.
    const [, , , , , , fresh] = await ethers.getSigners();
    const supply1 = await vault.totalSupply();
    const balB1 = await cB.balanceOf(vAddr);
    const balC1 = await c.balanceOf(vAddr);
    const nShares = (ONE / 7n) + 3n; // arbitrary non-dividing mint
    const ceilDiv = (x: bigint, y: bigint) => (x + y - 1n) / y;
    const needB = ceilDiv(balB1 * nShares, supply1);
    const needC = ceilDiv(balC1 * nShares, supply1);
    const floorC = balC1 * nShares / supply1;
    // C is in _held but NOT in the recipe (_tokens) — proves a non-recipe held token is pulled
    expect(needC).to.be.greaterThan(0n);
    expect(needC).to.equal(floorC + 1n); // ceil is exactly one wei above floor for this fixture
    await cB.mint(fresh.address, needB);
    await c.mint(fresh.address, needC);
    await cB.connect(fresh).approve(vAddr, needB);
    await c.connect(fresh).approve(vAddr, needC);
    const vC0 = await c.balanceOf(vAddr);
    await vault.connect(fresh).create(nShares);
    expect(await vault.balanceOf(fresh.address)).to.equal(nShares);
    // vault pulled exactly needC of C (non-zero, non-recipe token)
    expect((await c.balanceOf(vAddr)) - vC0).to.equal(needC);

    // 5. last-share drain: redeem the WHOLE supply, drains every held token to 0.
    // consolidate the full supply onto the redeemer so a single redeem clears it.
    await vault.connect(fresh).transfer(redeemer.address, await vault.balanceOf(fresh.address));
    const full = await vault.totalSupply();
    await vault.connect(redeemer).redeem(full);
    expect(await vault.totalSupply()).to.equal(0n);
    // Pins the missed-token bug: C (the non-recipe token, only in _held) is fully paid out -> 0.
    // A redeem iterating _tokens instead of _held would strand C here.
    expect(await cB.balanceOf(vAddr)).to.equal(0n);
    expect(await c.balanceOf(vAddr)).to.equal(0n);
    // redeem does NOT prune: 0-balance tokens intentionally linger in _held (harmless — create/redeem
    // yield 0 for them and skip). The set still lists B and C, it is not emptied.
    const heldAfter = (await vault.heldTokens()).map((x: string) => x.toLowerCase());
    expect(heldAfter.length).to.equal(2);
    expect(heldAfter).to.include((await cB.getAddress()).toLowerCase());
    expect(heldAfter).to.include((await c.getAddress()).toLowerCase());
  });
});
