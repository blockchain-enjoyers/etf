import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, HOUR, EMPTY } from "./helpers";

const ASSET = "0x1111111111111111111111111111111111111111";
const FEED = ethers.id("TSLA/USD-Streams-RegularHours");
const V11 = { Regular: 2, Closed: 5 };
const ns = (s: number | bigint) => BigInt(s) * 10n ** 9n;
const DEPTH_TIER = 5_000_000n * ONE;

async function deploy() {
  const [owner] = await ethers.getSigners();
  const Verifier = await ethers.getContractFactory("MockVerifierProxy");
  const verifier = await Verifier.deploy();
  const Adapter = await ethers.getContractFactory("ChainlinkAdapter");
  const adapter = await Adapter.deploy(await verifier.getAddress(), 11);
  const Router = await ethers.getContractFactory("OracleRouter");
  const router = await Router.deploy(
    await adapter.getAddress(), ethers.ZeroAddress, HOUR, HOUR, owner.address
  );
  await router.setFeed(ASSET, FEED);

  const Src = await ethers.getContractFactory("L2RouterSource");
  const src = await Src.deploy(await router.getAddress(), DEPTH_TIER);

  async function setAndIngest(mid: bigint, tsSec: number, status: number) {
    await verifier.setEquityReport(FEED, mid, 0n, 0n, ns(tsSec), status);
    await router.ingest(ASSET, payloadFor(FEED));
  }
  const payloadFor = (feedId: string) =>
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [feedId]);
  return { owner, router, src, setAndIngest, payloadFor };
}

describe("L2RouterSource", () => {
  it("maps a fresh Open L2 reading to a healthy SourceReading with the depth tier", async () => {
    const { src, setAndIngest } = await loadFixture(deploy);
    await setAndIngest(300n * ONE, await time.latest(), V11.Regular);
    // payload carries the asset to read from the L2 router
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ASSET]);
    const r = await src.readSource(payload);
    expect(r.price).to.equal(300n * ONE);
    expect(r.depth).to.equal(DEPTH_TIER);
    expect(r.weekendAware).to.equal(false);
    expect(r.healthy).to.equal(true);
  });

  it("maps a Closed L2 reading to unhealthy (so the aggregator drops it)", async () => {
    const { src, setAndIngest } = await loadFixture(deploy);
    await setAndIngest(300n * ONE, await time.latest(), V11.Closed);
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ASSET]);
    const r = await src.readSource(payload);
    expect(r.healthy).to.equal(false);
  });
});
