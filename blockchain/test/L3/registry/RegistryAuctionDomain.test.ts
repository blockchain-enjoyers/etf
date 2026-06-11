// REGRESSION LOCK (H1, deferred): RebalanceAuction._deriveMinOut reads IERC20.balanceOf(vault)
// (the erc20Domain here) while RegistryRebalanceVault.executeRebalance enforces the claim custody
// (claimDomain). They diverge once any AP stages inventory, so the auction MUST NOT be wired to a
// registry vault (vault.setExecutor(auction)) until _deriveMinOut is made claim-domain-aware.
// See IMPROVEMENTS H1.
//
// This test is deterministic and proves the mismatch precondition. It does NOT modify any contract.

import { expect } from "chai";
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const ONE = 10n ** 18n;
const ENC = ["address", "uint256", "uint256"];

async function deployRegistry() {
  const [deployer, manager, meridian, treasury, ap, stager] = await ethers.getSigners();

  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A", "A", 18);
  const b = await Tok.deploy("B", "B", 18);
  let [t0, t1] = [await a.getAddress(), await b.getAddress()];
  let [c0, c1] = [a, b];
  // Sort ascending so the registry accepts them in Merkle order
  if (BigInt(t0) > BigInt(t1)) {
    [t0, t1] = [t1, t0];
    [c0, c1] = [c1, c0];
  }
  const tokens = [t0, t1];
  const unitQty = [2n * ONE, 3n * ONE];
  const unitSize = ONE;

  // Build Merkle tree and proofs
  const values = tokens.map((t, i) => [t, unitQty[i].toString(), unitSize.toString()]);
  const tree = StandardMerkleTree.of(values, ENC);
  const proofByToken: Record<string, string[]> = {};
  for (const [i, v] of tree.entries()) proofByToken[v[0]] = tree.getProof(i);
  const proofs = tokens.map((t) => proofByToken[t]);

  // KeeperModule
  const Km = await ethers.getContractFactory("KeeperModule");
  const km = await Km.deploy(deployer.address);

  // USDG (fee token)
  const usdg = await Tok.deploy("USDG", "USDG", 18);
  const usdgAddr = await usdg.getAddress();

  // Deploy factory and implementations
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
  await f.setFeeToken(usdgAddr);
  await f.setDefaultFlatFees(0n, 0n);

  // Create registry vault
  const idx = {
    genesisRoot: tree.root,
    tokens,
    unitSize,
    name: "TestIdx",
    symbol: "TIDX",
    manager: manager.address,
    managerFeeBps: 0,
    keeperBps: 0,
    keeperEscrow: await km.getAddress(),
  };
  const vaultAddr = await f.createRegistryIndex.staticCall(idx, ethers.ZeroHash);
  await f.createRegistryIndex(idx, ethers.ZeroHash);
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);

  const idOf = (t: string) => BigInt(t);

  // Helper: wrap `amt` of `token` for `who`
  async function wrapFor(who: any, tok: any, token: string, amt: bigint) {
    await tok.mint(who.address, amt);
    await tok.connect(who).approve(vaultAddr, amt);
    await vault.connect(who).wrap(token, amt);
  }

  return {
    deployer, manager, meridian, treasury, ap, stager,
    c0, c1, t0, t1, tokens, unitQty, unitSize, proofs,
    vault, vaultAddr, km, usdg, usdgAddr,
    idOf, wrapFor,
  };
}

describe("RegistryAuctionDomain — H1 regression lock (balance-domain mismatch)", () => {
  it("proves: erc20Domain > claimDomain once a stager wraps inventory (the root cause the auction trips on)", async () => {
    const ctx = await deployRegistry();
    const { ap, stager, vault, vaultAddr, c0, c1, t0, t1, tokens, unitQty, proofs, idOf, wrapFor } = ctx;

    // ── Step 1: bootstrap the vault (AP wraps unitQty of both tokens then calls bootstrap) ──
    await wrapFor(ap, c0, t0, unitQty[0]);
    await wrapFor(ap, c1, t1, unitQty[1]);
    await vault.connect(ap).bootstrap(ONE, tokens, unitQty, proofs);

    // ── Step 2: snapshot the two domains for t0 immediately after bootstrap ──
    // claimDomain: vault's OWN ERC-6909 custody balance — what executeRebalance enforces via _portBalance
    const claimDomainBefore = await vault["balanceOf(address,uint256)"](vaultAddr, idOf(t0));
    // erc20Domain: raw ERC-20 balance — what RebalanceAuction._deriveMinOut reads
    const erc20Token0 = await ethers.getContractAt("MockERC20Decimals", t0);
    const erc20DomainBefore = await erc20Token0.balanceOf(vaultAddr);

    // Right after bootstrap with 1 share (nShares=1e18, unitQty[0]=2e18):
    // The vault holds unitQty[0]=2e18 of t0 as its OWN claim.
    // The ERC-20 balance of the vault contract also equals 2e18 (all wrapped tokens live here).
    expect(claimDomainBefore).to.equal(unitQty[0], "claim domain must equal unitQty[0] after bootstrap");
    expect(erc20DomainBefore).to.equal(unitQty[0], "erc20 domain must also equal unitQty[0] before any stager");

    // At this point the two domains are equal — no divergence yet.
    expect(erc20DomainBefore).to.equal(claimDomainBefore, "domains are equal before staging");

    // ── Step 3: stager wraps a LARGE amount of t0 into the vault ──
    // _wrap: pulls ERC-20 into the vault contract AND mints the claim to msg.sender (stager), NOT the vault.
    const BIG = 1000n * ONE;
    await wrapFor(stager, c0, t0, BIG);

    // ── Step 4: assert the divergence the auction would trip on ──
    // 4a. The vault's OWN claim custody is UNCHANGED by the stager's wrap — the claim went to the stager.
    const claimDomainAfter = await vault["balanceOf(address,uint256)"](vaultAddr, idOf(t0));
    expect(claimDomainAfter).to.equal(
      unitQty[0],
      "vault claim custody (claimDomain) must be unchanged: staging mints claims to stager, not vault",
    );

    // 4b. The ERC-20 balance of the vault CONTRACT increased by BIG (the real tokens are held by the contract).
    const erc20DomainAfter = await erc20Token0.balanceOf(vaultAddr);
    expect(erc20DomainAfter).to.equal(
      unitQty[0] + BIG,
      "ERC-20 balance (erc20Domain) must grow by BIG: stager's tokens are now inside the vault contract",
    );

    // 4c. The auction mismatch: _deriveMinOut sees the inflated erc20Domain; executeRebalance checks claimDomain.
    //     If the auction opened a release of exactly unitQty[0] of t0:
    //       _deriveMinOut computes: minOut = erc20DomainAfter - releaseOut = (unitQty[0]+BIG) - unitQty[0] = BIG
    //       executeRebalance checks:  _portBalance(t0) >= minOut  =>  unitQty[0] >= BIG  =>  2e18 >= 1000e18 => FAILS
    // This assertion proves the mismatch (erc20Domain strictly > claimDomain after staging):
    expect(erc20DomainAfter).to.be.greaterThan(
      claimDomainAfter,
      "erc20Domain must be strictly greater than claimDomain after staging — this IS the auction mismatch",
    );

    // Quantify the gap to make the bug concrete:
    const gap = erc20DomainAfter - claimDomainAfter;
    expect(gap).to.equal(BIG, "the domain gap equals exactly the stager's staged amount");
  });
});
