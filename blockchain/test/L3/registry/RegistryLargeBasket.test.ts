import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

// Proves the large-basket scheme end to end at scale: a 90-constituent registry index is ASSEMBLED in several
// chunked steps (batchWrap, chunkSize=30 -> 3 chunks), BOOTSTRAPPED over the full Merkle-committed set, then
// ENTERED and EXITED in-kind over ERC-6909 claims (create/redeem, pro-rata, claim-conserving), and MANAGED via
// a timelocked reconstitution (scheduleRoot -> activateRoot). 90 is the same code path as 500; the only
// difference at 500 is gas/number of chunks (see the on-chain-NAV-gas spec), not the mechanism.

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"]; // token, unitQty, unitSize
const N = 90;
const CHUNK = 30; // -> 3 batchWrap chunks to assemble the full set

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function deploy() {
  const [deployer, manager, meridian, treasury, ap, ap2] = await ethers.getSigners();

  // 90 distinct ERC-20 constituents, then sort strictly ascending (the recipe requires it).
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const built: { addr: string; c: any }[] = [];
  for (let i = 0; i < N; i++) {
    const t = await Tok.deploy(`T${i}`, `T${i}`, 18);
    built.push({ addr: await t.getAddress(), c: t });
  }
  built.sort((x, y) => (BigInt(x.addr) < BigInt(y.addr) ? -1 : 1));
  const tokens = built.map((b) => b.addr);
  const byAddr: Record<string, any> = {};
  for (const b of built) byAddr[b.addr] = b.c;
  const unitSize = ONE;
  const unitQty = tokens.map(() => ONE); // 1 unit of each name per index unit

  // Off-chain genesis Merkle root over the 90 (token, unitQty, unitSize) leaves + per-leaf proofs.
  const values = tokens.map((t, i) => [t, unitQty[i].toString(), unitSize.toString()]);
  const tree = StandardMerkleTree.of(values, ENC);
  const proofByToken: Record<string, string[]> = {};
  for (const [i, v] of tree.entries()) proofByToken[v[0]] = tree.getProof(i);
  const proofs = tokens.map((t) => proofByToken[t]);

  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);

  const Bv = await ethers.getContractFactory("BasketVault"); const bImpl = await Bv.deploy();
  const Mv = await ethers.getContractFactory("ManagedVault"); const mImpl = await Mv.deploy();
  const Cv = await ethers.getContractFactory("CommittedVault"); const cImpl = await Cv.deploy();
  const Rrv = await ethers.getContractFactory("RegistryRebalanceVault"); const rrImpl = await Rrv.deploy();
  const F = await ethers.getContractFactory("CloneFactory");
  const f = await F.deploy(await bImpl.getAddress(), await mImpl.getAddress(), await cImpl.getAddress());
  await f.setRegistryRebalanceImpl(await rrImpl.getAddress());
  await f.setMeridian(meridian.address);
  await f.setTreasury(treasury.address);
  await f.setPlatformFeeBps(0);
  for (const t of tokens) await f.setConstituentAllowed(t, true);

  const idx = {
    genesisRoot: tree.root, tokens, unitSize,
    name: "SP500x", symbol: "SP500x",
    manager: manager.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress(),
  };
  const vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
  await f.createRegistryIndex(idx, ethers.ZeroHash);
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);
  await vault.connect(meridian).setChunkSize(CHUNK);

  const idOf = (t: string) => BigInt(t);
  const claimBal = (who: string, token: string) => vault["balanceOf(address,uint256)"](who, idOf(token));

  // Assemble a holder's claims in CHUNKS: mint+approve every constituent, then batchWrap CHUNK at a time.
  // Returns how many batchWrap calls (chunks) it took.
  async function chunkedAssemble(who: any, perToken: bigint): Promise<number> {
    for (const t of tokens) {
      const c = byAddr[t];
      await c.mint(who.address, perToken);
      await c.connect(who).approve(vaultAddr, perToken);
    }
    const amts = tokens.map(() => perToken);
    const tokChunks = chunks(tokens, CHUNK);
    const amtChunks = chunks(amts, CHUNK);
    for (let i = 0; i < tokChunks.length; i++) {
      await vault.connect(who).batchWrap(tokChunks[i], amtChunks[i]);
    }
    return tokChunks.length;
  }

  return { vault, vaultAddr, f, deployer, manager, meridian, ap, ap2, tokens, unitQty, unitSize, proofs, tree, byAddr, idOf, claimBal, chunkedAssemble };
}

describe("RegistryRebalanceVault — 90-constituent large basket (assemble in chunks, bootstrap, in-kind enter/exit)", () => {
  it("assembles 90 names in 3 chunks, bootstraps, then create + redeem are pro-rata and claim-conserving", async () => {
    const fx = await loadFixture(deploy);
    const { vault, vaultAddr, ap, ap2, tokens, unitQty, proofs, claimBal } = fx;

    // 1. ASSEMBLE: the AP stages 2 units of every name, in 3 chunks of 30 (the multi-step path).
    const apChunks = await fx.chunkedAssemble(ap, 2n * ONE);
    expect(apChunks).to.equal(3); // 90 / chunkSize(30) = 3 batchWrap calls
    expect(await claimBal(ap.address, tokens[0])).to.equal(2n * ONE);
    expect(await claimBal(ap.address, tokens[N - 1])).to.equal(2n * ONE);

    // 2. BOOTSTRAP the FULL 90-name set against the Merkle root -> mints 2 index units.
    await vault.connect(ap).bootstrap(2n * ONE, tokens, unitQty, proofs);
    expect(await vault.totalSupply()).to.equal(2n * ONE);
    expect(await vault.heldTokens()).to.have.length(N);
    // the AP's claims moved into the vault's own custody (2 of each name backs the 2 units)
    expect(await claimBal(vaultAddr, tokens[0])).to.equal(2n * ONE);
    expect(await claimBal(vaultAddr, tokens[45])).to.equal(2n * ONE);

    // 3. ENTER (in-kind create): ap2 stages 1 unit of every name (again chunked) then creates 1 share.
    //    holdings 2/name at supply 2 -> need ceil(2*1/2) = 1 of each name.
    await fx.chunkedAssemble(ap2, ONE);
    await vault.connect(ap2).create(ONE);
    expect(await vault.balanceOf(ap2.address)).to.equal(ONE);
    expect(await vault.totalSupply()).to.equal(3n * ONE);
    // ap2's staged claims were fully consumed into the vault (now 3 of each name)
    expect(await claimBal(ap2.address, tokens[0])).to.equal(0n);
    expect(await claimBal(vaultAddr, tokens[0])).to.equal(3n * ONE);

    // 4. EXIT (in-kind redeem): ap2 burns its 1 share -> claims returned pro-rata over all 90 names.
    //    holdings 3/name at supply 3 -> out floor(3*1/3) = 1 of each name.
    await vault.connect(ap2).redeem(ONE);
    expect(await vault.balanceOf(ap2.address)).to.equal(0n);
    expect(await vault.totalSupply()).to.equal(2n * ONE);
    // pro-rata exit landed across the WHOLE set (spot-check first / middle / last)
    expect(await claimBal(ap2.address, tokens[0])).to.equal(ONE);
    expect(await claimBal(ap2.address, tokens[45])).to.equal(ONE);
    expect(await claimBal(ap2.address, tokens[N - 1])).to.equal(ONE);
    // still a 90-name basket, and the vault is back to backing its 2 units
    expect(await vault.heldTokens()).to.have.length(N);
    expect(await claimBal(vaultAddr, tokens[0])).to.equal(2n * ONE);

    // 5. CLAIM CONSERVATION: every name's claims = what was wrapped (ap 2 + ap2 1 = 3), nothing minted/lost.
    for (const i of [0, 45, N - 1]) {
      const inVault = await claimBal(vaultAddr, tokens[i]);
      const withAp2 = await claimBal(ap2.address, tokens[i]);
      expect(inVault + withAp2).to.equal(3n * ONE);
    }
  });

  it("manage: a timelocked reconstitution flips the committed root over the full 90-name set", async () => {
    const fx = await loadFixture(deploy);
    const { vault, manager, tokens, unitSize } = fx;

    // New target recipe over the same 90 names with a different weight on one leg.
    const newQty = tokens.map((_, i) => (i === 7 ? 2n * ONE : ONE));
    const newRoot = StandardMerkleTree.of(
      tokens.map((t, i) => [t, newQty[i].toString(), unitSize.toString()]),
      ENC,
    ).root;

    await vault.connect(manager).scheduleRoot(newRoot, tokens, newQty, unitSize);
    // Cannot activate before the 7-day timelock.
    await expect(vault.connect(manager).activateRoot()).to.be.revertedWithCustomError(vault, "RootTimelockNotElapsed");
    await time.increase(7 * 24 * 3600);
    await expect(vault.connect(manager).activateRoot()).to.emit(vault, "RootActivated").withArgs(newRoot);
    expect(await vault.recipeRoot()).to.equal(newRoot);
  });
});
