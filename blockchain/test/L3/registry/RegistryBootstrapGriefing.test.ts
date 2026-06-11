import { expect } from "chai";
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"];

describe("RegistryRebalanceVault — partial-bootstrap griefing (H2)", () => {
  it("a griefer who wraps ONE constituent can front-run a partial seed; the honest full bootstrap then reverts", async () => {
    const [deployer, manager, griefer, ap] = await ethers.getSigners();
    const Tok = await ethers.getContractFactory("MockERC20Decimals");
    const a = await Tok.deploy("A", "A", 18); const b = await Tok.deploy("B", "B", 18);
    let [t0, t1] = [await a.getAddress(), await b.getAddress()];
    let [c0, c1] = [a, b];
    if (BigInt(t0) > BigInt(t1)) { [t0, t1] = [t1, t0]; [c0, c1] = [c1, c0]; }
    const tokens = [t0, t1]; const unitQty = [2n * ONE, 3n * ONE]; const unitSize = ONE;
    const values = tokens.map((t, i) => [t, unitQty[i].toString(), unitSize.toString()]);
    const tree = StandardMerkleTree.of(values, ENC);
    const proofByToken: Record<string, string[]> = {};
    for (const [i, v] of tree.entries()) proofByToken[v[0]] = tree.getProof(i);

    const Bv = await ethers.getContractFactory("BasketVault");
    const Mv = await ethers.getContractFactory("ManagedVault");
    const Cv = await ethers.getContractFactory("CommittedVault");
    const Rrv = await ethers.getContractFactory("RegistryRebalanceVault");
    const F = await ethers.getContractFactory("CloneFactory");
    const f = await F.deploy(await (await Bv.deploy()).getAddress(), await (await Mv.deploy()).getAddress(), await (await Cv.deploy()).getAddress());
    await f.setRegistryRebalanceImpl(await (await Rrv.deploy()).getAddress());
    await f.setConstituentAllowed(t0, true); await f.setConstituentAllowed(t1, true);
    const Km = await ethers.getContractFactory("KeeperModule"); const km = await Km.deploy(deployer.address);

    const idx = { genesisRoot: tree.root, tokens, unitSize, name: "X", symbol: "X",
      manager: manager.address, managerFeeBps: 0, keeperBps: 0, keeperEscrow: await km.getAddress() };
    const vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
    await f.createRegistryIndex(idx, ethers.ZeroHash);
    const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);

    // Griefer wraps ONLY t0 and bootstraps a partial (single-leaf) set.
    await c0.mint(griefer.address, unitQty[0]);
    await c0.connect(griefer).approve(vaultAddr, unitQty[0]);
    await vault.connect(griefer).wrap(t0, unitQty[0]);
    await vault.connect(griefer).bootstrap(unitSize, [t0], [unitQty[0]], [proofByToken[t0]]);

    // The held set is now incomplete (only t0), and the honest full bootstrap reverts.
    expect(await vault.heldTokens()).to.deep.equal([t0]);
    await c0.mint(ap.address, unitQty[0]); await c1.mint(ap.address, unitQty[1]);
    await c0.connect(ap).approve(vaultAddr, unitQty[0]); await c1.connect(ap).approve(vaultAddr, unitQty[1]);
    await vault.connect(ap).wrap(t0, unitQty[0]); await vault.connect(ap).wrap(t1, unitQty[1]);
    await expect(
      vault.connect(ap).bootstrap(unitSize, tokens, unitQty, [proofByToken[t0], proofByToken[t1]]),
    ).to.be.revertedWithCustomError(vault, "AlreadyBootstrapped");
  });
});
