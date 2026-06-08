import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const FEED = ethers.id("TSLA");

async function committee() {
  const w = [ethers.Wallet.createRandom(), ethers.Wallet.createRandom(), ethers.Wallet.createRandom()];
  const members = w.map((x) => x.address).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  return { w, members };
}

// sign keccak(abi.encode(...digestParts)) with the given wallets, return ascending-by-address sig arrays
async function sigSet(wallets: any[], digest: string) {
  const sigs = await Promise.all(
    wallets.map(async (x) => {
      const s = ethers.Signature.from(await x.signingKey.sign(digest));
      return { addr: x.address, r: s.r, s: s.s, v: s.v };
    })
  );
  sigs.sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1));
  return { r: sigs.map((x) => x.r), s: sigs.map((x) => x.s), v: sigs.map((x) => x.v) };
}

describe("RedStoneSource", () => {
  async function deploy() {
    const [owner] = await ethers.getSigners();
    const { w, members } = await committee();
    const Src = await ethers.getContractFactory("RedStoneSource");
    const src = await Src.deploy(owner.address, 5_000_000n * ONE, true); // weekendAware=true
    await src.setCommittee(members, 2);
    return { src, w };
  }
  function payload(price: bigint, ts: number, r: any) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint64", "bytes32[]", "bytes32[]", "uint8[]"],
      [FEED, price, ts, r.r, r.s, r.v]
    );
  }
  it("accepts >= threshold; weekendAware=true", async () => {
    const { src, w } = await loadFixture(deploy);
    const ts = await time.latest();
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32", "uint256", "uint64"], ["redstone", FEED, 300n * ONE, ts])
    );
    const r = await sigSet([w[0], w[1]], digest);
    const out = await src.read.staticCall(payload(300n * ONE, ts, r));
    expect(out.price).to.equal(300n * ONE);
    expect(out.weekendAware).to.equal(true);
    expect(out.healthy).to.equal(true);
    expect(out.kind).to.equal(4); // ORACLE_PULL
  });
  it("reverts below threshold", async () => {
    const { src, w } = await loadFixture(deploy);
    const ts = await time.latest();
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32", "uint256", "uint64"], ["redstone", FEED, 300n * ONE, ts])
    );
    const r = await sigSet([w[0]], digest);
    await expect(src.read.staticCall(payload(300n * ONE, ts, r))).to.be.revertedWithCustomError(src, "ThresholdNotMet");
  });
});

describe("ChronicleSource", () => {
  async function deploy() {
    const [owner] = await ethers.getSigners();
    const { w, members } = await committee();
    const Src = await ethers.getContractFactory("ChronicleSource");
    const src = await Src.deploy(owner.address, 5_000_000n * ONE);
    await src.setCommittee(members, 2);
    return { src, w };
  }
  it("accepts >= threshold over the chronicle-domain digest", async () => {
    const { src, w } = await loadFixture(deploy);
    const ts = await time.latest();
    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32", "uint256", "uint64"], ["chronicle", FEED, 250n * ONE, ts])
    );
    const r = await sigSet([w[0], w[1]], digest);
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint64", "bytes32[]", "bytes32[]", "uint8[]"],
      [FEED, 250n * ONE, ts, r.r, r.s, r.v]
    );
    const out = await src.read.staticCall(payload);
    expect(out.price).to.equal(250n * ONE);
    expect(out.healthy).to.equal(true);
  });
});
