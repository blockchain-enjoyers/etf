import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const FEED = ethers.id("TSLA");

async function deploy() {
  const [owner] = await ethers.getSigners();
  const s1 = ethers.Wallet.createRandom();
  const s2 = ethers.Wallet.createRandom();
  const s3 = ethers.Wallet.createRandom();
  const members = [s1.address, s2.address, s3.address].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const Src = await ethers.getContractFactory("UniversalSignedSource");
  const src = await Src.deploy(owner.address);
  await src.setCommittee(members, 2); // 2-of-3
  return { src, signers: { s1, s2, s3 }, owner };
}

// build the digest the adapter signs over and a sorted-by-recovered-address signature set
async function signReading(wallets: any[], feedId: string, price: bigint, depth: bigint, ts: number) {
  const digest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "bytes32", "uint256", "uint256", "uint64"],
      ["universal", feedId, price, depth, ts]
    )
  );
  const sigs = await Promise.all(wallets.map(async (w) => {
    const sig = ethers.Signature.from(await w.signingKey.sign(digest));
    return { addr: w.address, r: sig.r, s: sig.s, v: sig.v };
  }));
  sigs.sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1)); // recovered addresses must arrive ascending
  const r = sigs.map((x) => x.r), s = sigs.map((x) => x.s), v = sigs.map((x) => x.v);
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "uint256", "uint256", "uint64", "bytes32[]", "bytes32[]", "uint8[]"],
    [feedId, price, depth, ts, r, s, v]
  );
}

describe("UniversalSignedSource", () => {
  it("accepts a >= threshold signature set and returns the reading", async () => {
    const { src, signers } = await loadFixture(deploy);
    const ts = await time.latest();
    const payload = await signReading([signers.s1, signers.s2], FEED, 300n * ONE, 5_000_000n * ONE, ts);
    const r = await src.read.staticCall(payload);
    expect(r.price).to.equal(300n * ONE);
    expect(r.depth).to.equal(5_000_000n * ONE);
    expect(r.healthy).to.equal(true);
  });

  it("reverts below threshold (only 1 of 2)", async () => {
    const { src, signers } = await loadFixture(deploy);
    const ts = await time.latest();
    const payload = await signReading([signers.s1], FEED, 300n * ONE, 5_000_000n * ONE, ts);
    await expect(src.read.staticCall(payload)).to.be.revertedWithCustomError(src, "ThresholdNotMet");
  });

  it("ignores a non-committee signer", async () => {
    const { src, signers } = await loadFixture(deploy);
    const outsider = ethers.Wallet.createRandom();
    const ts = await time.latest();
    const payload = await signReading([signers.s1, outsider], FEED, 300n * ONE, 5_000_000n * ONE, ts);
    await expect(src.read.staticCall(payload)).to.be.revertedWithCustomError(src, "ThresholdNotMet"); // only 1 valid
  });
});
