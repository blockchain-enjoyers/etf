import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const FEED = ethers.id("TSLA/USD-Streams");
const coder = ethers.AbiCoder.defaultAbiCoder();

// MockVerifierProxy.verify returns whatever bytes we set; here we set it to an abi-encoded report.
async function deploy(schemaVersion: number) {
  const V = await ethers.getContractFactory("MockVerifierProxy");
  const verifier = await V.deploy();
  const S = await ethers.getContractFactory("ChainlinkStreamsSource");
  const src = await S.deploy(await verifier.getAddress(), schemaVersion, 5_000_000n * ONE); // depthTier
  return { verifier, src };
}

// named fixtures: loadFixture rejects anonymous functions (it caches by reference)
async function deployV8() { return deploy(8); }
async function deployV11() { return deploy(11); }

function encodeV11(mid: bigint, bid: bigint, ask: bigint, status: number, tsNs: bigint) {
  return coder.encode(
    ["tuple(bytes32,uint32,uint32,uint192,uint192,uint32,int192,int192,int192,int192,int192,int192,uint32,uint64)"],
    [[FEED, 0, 0, 0, 0, 0, mid, bid, 0n, ask, 0n, 0n, status, tsNs]]
  );
}
function encodeV8(mid: bigint, status: number, tsNs: bigint) {
  return coder.encode(
    ["tuple(bytes32,uint32,uint32,uint192,uint192,uint32,uint64,int192,uint32)"],
    [[FEED, 0, 0, 0, 0, 0, tsNs, mid, status]]
  );
}

describe("ChainlinkStreamsSource — decode (mock verifier, no key)", () => {
  it("v11: decodes mid + Regular(2)->Open, confidence from book", async () => {
    const { verifier, src } = await loadFixture(deployV11);
    const tsNs = BigInt(await time.latest()) * 10n ** 9n;
    await verifier.setVerifyResult(encodeV11(300n * ONE, 299n * ONE, 301n * ONE, 2, tsNs));
    const r = await src.read.staticCall("0x"); // payload forwarded opaquely to verify
    expect(r.price).to.equal(300n * ONE);
    expect(r.confidence).to.equal(ONE); // (301-299)/2
    expect(r.healthy).to.equal(true);
    expect(r.kind).to.equal(5); // RWA_STREAM
  });

  it("v11: Closed(5) -> unhealthy", async () => {
    const { verifier, src } = await loadFixture(deployV11);
    const tsNs = BigInt(await time.latest()) * 10n ** 9n;
    await verifier.setVerifyResult(encodeV11(300n * ONE, 0n, 0n, 5, tsNs));
    const r = await src.read.staticCall("0x");
    expect(r.healthy).to.equal(false);
  });

  it("v8: decodes midPrice + Open(2)", async () => {
    const { verifier, src } = await loadFixture(deployV8);
    const tsNs = BigInt(await time.latest()) * 10n ** 9n;
    await verifier.setVerifyResult(encodeV8(250n * ONE, 2, tsNs));
    const r = await src.read.staticCall("0x");
    expect(r.price).to.equal(250n * ONE);
    expect(r.healthy).to.equal(true);
  });
});
