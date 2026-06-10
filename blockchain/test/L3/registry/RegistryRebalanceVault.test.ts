import { expect } from "chai";
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"]; // token, unitQty, unitSize

// Deploy a registry leaf via the factory + build the Merkle recipe. Returns helpers to drive bootstrap/create/redeem.
async function deployRegistryFixture() {
  const [deployer, manager, ap, ap2] = await ethers.getSigners();

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  let [c0, c1] = [a, b];
  if (BigInt(t0) > BigInt(t1)) { [t0, t1] = [t1, t0]; [c0, c1] = [c1, c0]; }
  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;

  // off-chain StandardMerkleTree root + per-leaf proofs (the factory takes the root; bootstrap takes proofs)
  const values = tokens.map((t, i) => [t, unitQty[i].toString(), unitSize.toString()]);
  const tree = StandardMerkleTree.of(values, ENC);
  const root = tree.root;
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

  const idx = {
    genesisRoot: root, tokens, unitSize,
    name: "SP500x", symbol: "SP500x",
    manager: manager.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress(),
  };
  const vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
  await f.createRegistryIndex(idx, ethers.ZeroHash);
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);

  // helper: an account wraps its real ERC-20 into claims, then approves nothing (claims move internally)
  async function wrapFor(who: any, amtA: bigint, amtB: bigint) {
    await c0.mint(who.address, amtA); await c1.mint(who.address, amtB);
    await c0.connect(who).approve(vaultAddr, amtA);
    await c1.connect(who).approve(vaultAddr, amtB);
    if (amtA > 0n) await vault.connect(who).wrap(t0, amtA);
    if (amtB > 0n) await vault.connect(who).wrap(t1, amtB);
  }

  const idOf = (t: string) => BigInt(t); // id = uint160(token)
  async function claimBal(who: string, token: string) {
    return await vault["balanceOf(address,uint256)"](who, idOf(token));
  }

  return { vault, vaultAddr, deployer, manager, ap, ap2, tokens, unitQty, unitSize, proofs, wrapFor, claimBal, c0, c1 };
}

describe("RegistryRebalanceVault — bootstrap + holdings create/redeem over claims", () => {
  it("bootstraps from a Merkle-validated recipe, then create/redeem are holdings-based over claims", async () => {
    // AP wraps the 2-name target (2 units worth) into claims, then bootstraps 2 shares
    const fx = await deployRegistryFixture();
    await fx.wrapFor(fx.ap, fx.unitQty[0] * 2n, fx.unitQty[1] * 2n);

    await fx.vault.connect(fx.ap).bootstrap(2n * ONE, fx.tokens, fx.unitQty, fx.proofs);
    expect(await fx.vault.totalSupply()).to.equal(2n * ONE);
    expect(await fx.vault.heldTokens()).to.have.length(fx.tokens.length);
    // the AP's claims moved INTO the vault's own custody
    expect(await fx.vault.connect(fx.ap)["balanceOf(address,uint256)"](fx.vaultAddr, BigInt(fx.tokens[0]))).to.equal(fx.unitQty[0] * 2n);

    // post-bootstrap create is holdings-based: ap2 wraps + creates 1 share (pro-rata over holdings)
    // holdings: 4A, 6B for supply 2 -> 1 share needs ceil(4*1/2)=2A, ceil(6*1/2)=3B
    await fx.wrapFor(fx.ap2, 2n * ONE, 3n * ONE);
    await fx.vault.connect(fx.ap2).create(1n * ONE);
    expect(await fx.vault.balanceOf(fx.ap2.address)).to.equal(1n * ONE);

    // redeem returns claims pro-rata (internal), no ERC-20 move
    const erc20VaultA = await fx.c0.balanceOf(fx.vaultAddr);
    await fx.vault.connect(fx.ap2).redeem(1n * ONE);
    expect(await fx.claimBal(fx.ap2.address, fx.tokens[0])).to.be.greaterThan(0n);
    // the underlying ERC-20 held by the vault never moved during the internal claim reassignment
    expect(await fx.c0.balanceOf(fx.vaultAddr)).to.equal(erc20VaultA);
  });

  it("create before bootstrap reverts NotBootstrapped", async () => {
    const { vault, ap } = await deployRegistryFixture();
    await expect(vault.connect(ap).create(ONE)).to.be.revertedWithCustomError(vault, "NotBootstrapped");
  });

  it("bootstrap twice reverts AlreadyBootstrapped", async () => {
    const fx = await deployRegistryFixture();
    await fx.wrapFor(fx.ap, fx.unitQty[0] * 2n, fx.unitQty[1] * 2n);
    await fx.vault.connect(fx.ap).bootstrap(2n * ONE, fx.tokens, fx.unitQty, fx.proofs);
    await expect(
      fx.vault.connect(fx.ap).bootstrap(ONE, fx.tokens, fx.unitQty, fx.proofs)
    ).to.be.revertedWithCustomError(fx.vault, "AlreadyBootstrapped");
  });

  it("bootstrap with a leaf not in the root reverts LeafNotInRoot", async () => {
    const fx = await deployRegistryFixture();
    await fx.wrapFor(fx.ap, fx.unitQty[0] * 2n, fx.unitQty[1] * 2n);
    // wrong unitQty for token0 -> proof no longer validates that leaf
    const badQty = [fx.unitQty[0] + 1n, fx.unitQty[1]];
    await expect(
      fx.vault.connect(fx.ap).bootstrap(2n * ONE, fx.tokens, badQty, fx.proofs)
    ).to.be.revertedWithCustomError(fx.vault, "LeafNotInRoot");
  });

  it("bootstrap with a non-unit-multiple nShares reverts NonMultipleOfUnitSize", async () => {
    const fx = await deployRegistryFixture();
    await fx.wrapFor(fx.ap, fx.unitQty[0] * 2n, fx.unitQty[1] * 2n);
    await expect(
      fx.vault.connect(fx.ap).bootstrap(ONE / 2n, fx.tokens, fx.unitQty, fx.proofs)
    ).to.be.revertedWithCustomError(fx.vault, "NonMultipleOfUnitSize");
  });
});
