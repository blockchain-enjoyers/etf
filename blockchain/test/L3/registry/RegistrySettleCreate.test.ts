import { expect } from "chai";
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

// RegistryRebalanceVault.settleCreate — the single-shot cash-in primitive the L5 queue calls (Part 3, Task 1).
// Same share-math as create(), but pull-from-AP / mint-to-user, gated to a registered settler. The pulled claim
// amount is VAULT-COMPUTED (pro-rata need_i), never caller-supplied -> a settler can never over-pull.

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"];

async function deployFixture() {
  const [deployer, manager, meridian, treasury, ap, user, settler, outsider] = await ethers.getSigners();

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  let [c0, c1] = [a, b];
  if (BigInt(t0) > BigInt(t1)) { [t0, t1] = [t1, t0]; [c0, c1] = [c1, c0]; }
  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;

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
  await f.setConstituentAllowed(t0, true);
  await f.setConstituentAllowed(t1, true);
  await f.setMeridian(meridian.address);
  await f.setTreasury(treasury.address);
  await f.setPlatformFeeBps(0);

  const idx = {
    genesisRoot: tree.root, tokens, unitSize,
    name: "SP500x", symbol: "SP500x",
    manager: manager.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress(),
  };
  const vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
  await f.createRegistryIndex(idx, ethers.ZeroHash);
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);

  const idOf = (t: string) => BigInt(t);
  const claimBal = (who: string, token: string) => vault["balanceOf(address,uint256)"](who, idOf(token));

  async function wrapFor(who: any, amtT0: bigint, amtT1: bigint) {
    if (amtT0 > 0n) { await c0.mint(who.address, amtT0); await c0.connect(who).approve(vaultAddr, amtT0); await vault.connect(who).wrap(t0, amtT0); }
    if (amtT1 > 0n) { await c1.mint(who.address, amtT1); await c1.connect(who).approve(vaultAddr, amtT1); await vault.connect(who).wrap(t1, amtT1); }
  }

  // register the settler
  await vault.connect(meridian).setSettler(settler.address, true);

  return { deployer, manager, meridian, treasury, ap, user, settler, outsider, c0, c1, t0, t1, tokens, unitQty, unitSize, proofs, vault, vaultAddr, idOf, claimBal, wrapFor };
}

async function bootstrapped() {
  const fx = await deployFixture();
  // bootstrap supply 1e18, holdings 2e18 A / 3e18 B
  await fx.wrapFor(fx.ap, 2n * ONE, 3n * ONE);
  await fx.vault.connect(fx.ap).bootstrap(ONE, fx.tokens, fx.unitQty, fx.proofs);
  return fx;
}

describe("RegistryRebalanceVault.settleCreate (Task 1)", () => {
  it("a registered settler pulls the exact pro-rata slice from the AP and mints to the user", async () => {
    const fx = await bootstrapped();
    const { vault, vaultAddr, ap, user, settler, t0, t1, claimBal } = fx;
    const N = ONE; // mint 1e18 shares; pro-rata need over holdings 2e18/3e18 at supply 1e18 = 2e18 A, 3e18 B

    // AP provisions the create-side claims and authorizes the SETTLER as its ERC-6909 operator
    await fx.wrapFor(ap, 2n * ONE, 3n * ONE);
    await vault.connect(ap).setOperator(settler.address, true);

    const vaultA0 = await claimBal(vaultAddr, t0);
    await vault.connect(settler).settleCreate(ap.address, user.address, N);

    expect(await vault.balanceOf(user.address)).to.equal(N);             // shares minted to the USER
    expect(await claimBal(ap.address, t0)).to.equal(0n);                 // exactly 2e18 pulled
    expect(await claimBal(ap.address, t1)).to.equal(0n);                 // exactly 3e18 pulled
    expect(await claimBal(vaultAddr, t0)).to.equal(vaultA0 + 2n * ONE);  // vault custody grew by the pulled slice
  });

  it("the pulled amount equals previewCreate(N) exactly (over-pull invariant: vault-computed, not caller-set)", async () => {
    const fx = await bootstrapped();
    const { vault, ap, user, settler, t0, t1, claimBal } = fx;
    const N = ONE / 2n; // 5e17 -> need ceil(2e18*5e17/1e18)=1e18 A, ceil(3e18*5e17/1e18)=1.5e18 B

    await fx.wrapFor(ap, 2n * ONE, 3n * ONE); // ample
    await vault.connect(ap).setOperator(settler.address, true);

    const [pTok, pAmt] = await vault.previewCreate(N);
    const apA0 = await claimBal(ap.address, t0);
    const apB0 = await claimBal(ap.address, t1);

    await vault.connect(settler).settleCreate(ap.address, user.address, N);

    const idx0 = pTok[0].toLowerCase() === t0.toLowerCase() ? 0 : 1;
    const idx1 = 1 - idx0;
    expect(apA0 - (await claimBal(ap.address, t0))).to.equal(pAmt[idx0]); // pulled exactly previewCreate amount
    expect(apB0 - (await claimBal(ap.address, t1))).to.equal(pAmt[idx1]);
    expect(await vault.balanceOf(user.address)).to.equal(N);
  });

  it("a non-settler caller reverts NotSettler", async () => {
    const fx = await bootstrapped();
    const { vault, ap, user, outsider } = fx;
    await vault.connect(ap).setOperator(outsider.address, true);
    await expect(vault.connect(outsider).settleCreate(ap.address, user.address, ONE))
      .to.be.revertedWithCustomError(vault, "NotSettler");
  });

  it("settleCreate before bootstrap reverts NotBootstrapped", async () => {
    const fx = await deployFixture();
    const { vault, ap, user, settler } = fx;
    await vault.connect(ap).setOperator(settler.address, true);
    await expect(vault.connect(settler).settleCreate(ap.address, user.address, ONE))
      .to.be.revertedWithCustomError(vault, "NotBootstrapped");
  });

  it("only meridian can register a settler", async () => {
    const fx = await deployFixture();
    const { vault, outsider } = fx;
    await expect(vault.connect(outsider).setSettler(outsider.address, true))
      .to.be.revertedWithCustomError(vault, "NotMeridian");
  });
});

describe("RegistryRebalanceVault — AP batchWrap + runtime chunkSize (Task 5)", () => {
  it("batchWrap of N <= chunkSize credits N claim ids in one tx", async () => {
    const fx = await deployFixture();
    const { vault, vaultAddr, c0, c1, t0, t1, ap, claimBal } = fx;
    expect(await vault.chunkSize()).to.equal(200n);

    const aA = 7n * ONE, aB = 11n * ONE;
    await c0.mint(ap.address, aA); await c0.connect(ap).approve(vaultAddr, aA);
    await c1.mint(ap.address, aB); await c1.connect(ap).approve(vaultAddr, aB);

    await vault.connect(ap).batchWrap([t0, t1], [aA, aB]);
    expect(await claimBal(ap.address, t0)).to.equal(aA);
    expect(await claimBal(ap.address, t1)).to.equal(aB);
  });

  it("an over-chunkSize batch reverts; setChunkSize(1) then a 2-token batch reverts", async () => {
    const fx = await deployFixture();
    const { vault, vaultAddr, c0, c1, t0, t1, ap, meridian, outsider } = fx;

    await c0.mint(ap.address, ONE); await c0.connect(ap).approve(vaultAddr, ONE);
    await c1.mint(ap.address, ONE); await c1.connect(ap).approve(vaultAddr, ONE);

    await vault.connect(meridian).setChunkSize(1);
    expect(await vault.chunkSize()).to.equal(1n);
    await expect(vault.connect(ap).batchWrap([t0, t1], [ONE, ONE]))
      .to.be.revertedWithCustomError(vault, "BadBatchSize");
    // a single-token batch is within the new bound
    await vault.connect(ap).batchWrap([t0], [ONE]);

    await expect(vault.connect(meridian).setChunkSize(0)).to.be.revertedWithCustomError(vault, "ZeroChunkSize");
    await expect(vault.connect(outsider).setChunkSize(5)).to.be.revertedWithCustomError(vault, "NotMeridian");
  });

  it("batchWrap with mismatched array lengths reverts", async () => {
    const fx = await deployFixture();
    const { vault, t0, t1, ap } = fx;
    await expect(vault.connect(ap).batchWrap([t0, t1], [ONE]))
      .to.be.revertedWithCustomError(vault, "BatchLengthMismatch");
  });
});
