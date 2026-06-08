import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const FEED = ethers.id("TSLA-tokenized");
const coder = ethers.AbiCoder.defaultAbiCoder();

async function deploy() {
  const V = await ethers.getContractFactory("MockVerifierProxy");
  const verifier = await V.deploy();
  const S = await ethers.getContractFactory("ChainlinkTokenizedSource");
  const src = await S.deploy(await verifier.getAddress(), 5_000_000n * ONE);
  return { verifier, src };
}

// ReportV10 tuple order
function encodeV10(price: bigint, status: number, mult: bigint, tokenizedPrice: bigint, tsNs: bigint) {
  return coder.encode(
    ["tuple(bytes32,uint32,uint32,uint192,uint192,uint32,int192,uint64,uint32,uint64,uint64,uint32,int192)"],
    [[FEED, 0, 0, 0, 0, 0, price, tsNs, status, mult, 0n, 0, tokenizedPrice]]
  );
}

describe("ChainlinkTokenizedSource — v10 (weekend tokenizedPrice)", () => {
  it("market Open (Regular=2): uses underlying price * multiplier, weekendAware=false", async () => {
    const { verifier, src } = await loadFixture(deploy);
    const tsNs = BigInt(await time.latest()) * 10n ** 9n;
    await verifier.setVerifyResult(encodeV10(300n * ONE, 2, ONE, 0n, tsNs)); // mult 1.0
    const r = await src.read.staticCall("0x");
    expect(r.price).to.equal(300n * ONE);
    expect(r.weekendAware).to.equal(false);
    expect(r.healthy).to.equal(true);
    expect(r.kind).to.equal(5); // RWA_STREAM
  });

  it("market Closed (5): uses tokenizedPrice, weekendAware=true", async () => {
    const { verifier, src } = await loadFixture(deploy);
    const tsNs = BigInt(await time.latest()) * 10n ** 9n;
    await verifier.setVerifyResult(encodeV10(300n * ONE, 5, ONE, 305n * ONE, tsNs));
    const r = await src.read.staticCall("0x");
    expect(r.price).to.equal(305n * ONE);
    expect(r.weekendAware).to.equal(true);
    expect(r.healthy).to.equal(true);
  });

  it("Closed with non-positive tokenizedPrice -> unhealthy", async () => {
    const { verifier, src } = await loadFixture(deploy);
    const tsNs = BigInt(await time.latest()) * 10n ** 9n;
    await verifier.setVerifyResult(encodeV10(300n * ONE, 5, ONE, 0n, tsNs));
    const r = await src.read.staticCall("0x");
    expect(r.healthy).to.equal(false);
  });
});
