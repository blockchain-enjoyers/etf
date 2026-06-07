// blockchain/test/L2/CommitmentNAVVerify.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { ONE } from "./helpers";

const coder = ethers.AbiCoder.defaultAbiCoder();

// One report = (feedId, mid). Hash = keccak256(abi.encode(feedId, mid)). k signers sign that hash.
// IMPORTANT: wallets must already be sorted ascending by address before calling this, so that the
// recovered signers arrive in strictly-ascending order (the contract's distinct-signer check uses a
// single `last` pointer rather than a visited-set mapping).
async function signReport(signers: any[], feedId: string, mid: bigint) {
  const h = ethers.keccak256(coder.encode(["bytes32", "int256"], [feedId, mid]));
  const sigs = [] as { r: string; s: string; v: number }[];
  for (const s of signers) {
    const sig = ethers.Signature.from(await s.signingKey.sign(h)); // sign raw 32-byte digest
    sigs.push({ r: sig.r, s: sig.s, v: sig.v });
  }
  return { feedId, mid, sigs };
}

describe("CommitmentNAV — inline DON-threshold verify (V path)", () => {
  it("verifies k signatures per report against the committee, then sums", async () => {
    const wallets = Array.from({ length: 4 }, () => ethers.Wallet.createRandom());
    // Sort by address ascending so the committee mapping + the signing order both use the same order.
    wallets.sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
    const committee = wallets.map((w) => w.address);
    const threshold = 3;

    const tokens = ["0x1111111111111111111111111111111111111111"];
    const unitQty = [2n * ONE];
    const C = await ethers.getContractFactory("CommitmentNAV");
    const c = await C.deploy(tokens, unitQty, ONE);

    await c.setCommittee(committee, threshold); // owner-set committee (one-time)

    const feedId = ethers.id("TSLA");
    // Use the first 3 wallets (already sorted); their recovered addresses are strictly ascending.
    const signers = wallets.slice(0, 3).map((w) => ({ signingKey: w.signingKey }));
    const rep = await signReport(signers, feedId, 300n * ONE);

    const nav = await c.navFromSignedReports(tokens, unitQty, ONE, {
      feedIds: [feedId],
      mids: [300n * ONE],
      r: [rep.sigs.map((x) => x.r)],
      s: [rep.sigs.map((x) => x.s)],
      v: [rep.sigs.map((x) => x.v)],
    });
    expect(nav).to.equal(600n * ONE); // 2 * 300
  });

  it("reverts below threshold", async () => {
    const wallets = Array.from({ length: 4 }, () => ethers.Wallet.createRandom());
    wallets.sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
    const committee = wallets.map((w) => w.address);
    const tokens = ["0x1111111111111111111111111111111111111111"];
    const C = await ethers.getContractFactory("CommitmentNAV");
    const c = await C.deploy(tokens, [ONE], ONE);
    await c.setCommittee(committee, 3);
    const feedId = ethers.id("TSLA");
    const rep = await (async () => {
      const h = ethers.keccak256(coder.encode(["bytes32", "int256"], [feedId, ONE]));
      const sig = ethers.Signature.from(await wallets[0].signingKey.sign(h));
      return { r: [sig.r], s: [sig.s], v: [sig.v] };
    })();
    await expect(
      c.navFromSignedReports(tokens, [ONE], ONE, { feedIds: [feedId], mids: [ONE], r: [rep.r], s: [rep.s], v: [rep.v] })
    ).to.be.revertedWithCustomError(c, "ThresholdNotMet");
  });
});
