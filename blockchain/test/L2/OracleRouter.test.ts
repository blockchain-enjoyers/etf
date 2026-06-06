import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, HOUR, Status, V11, payloadFor, ns } from "./helpers";

// OracleRouter: asset->feed registry, cache-on-ingest (the pull-model bridge), and the read-time gate
// (staleness -> Halted, sequencer down/grace -> Degraded, worst-of). Uses dummy asset addresses since
// the router never calls the asset itself.

const ASSET = "0x1111111111111111111111111111111111111111";
const FEED = ethers.id("TSLA/USD-Streams-RegularHours");

async function deployRouter(useSequencer = true) {
  const [owner, other] = await ethers.getSigners();

  const Verifier = await ethers.getContractFactory("MockVerifierProxy");
  const verifier = await Verifier.deploy();
  const Seq = await ethers.getContractFactory("MockSequencerUptimeFeed");
  const sequencer = await Seq.deploy();
  const Adapter = await ethers.getContractFactory("ChainlinkAdapter");
  const adapter = await Adapter.deploy(await verifier.getAddress(), 11);
  const Router = await ethers.getContractFactory("OracleRouter");
  const router = await Router.deploy(
    await adapter.getAddress(),
    useSequencer ? await sequencer.getAddress() : ethers.ZeroAddress,
    HOUR,
    HOUR,
    owner.address
  );
  await router.setFeed(ASSET, FEED);

  async function setReport(mid: bigint, bid: bigint, ask: bigint, tsSec: number, status: number) {
    await verifier.setEquityReport(FEED, mid, bid, ask, ns(tsSec), status);
  }
  async function ingest() {
    await router.ingest(ASSET, payloadFor(FEED));
  }
  return { owner, other, verifier, sequencer, adapter, router, setReport, ingest };
}
const deployWithSeq = () => deployRouter(true);
const deployNoSeq = () => deployRouter(false);

describe("OracleRouter — config & ingest", () => {
  it("setFeed is owner-only", async () => {
    const { router, other } = await loadFixture(deployWithSeq);
    await expect(router.connect(other).setFeed(ASSET, FEED)).to.be.revertedWithCustomError(
      router,
      "OwnableUnauthorizedAccount"
    );
  });

  it("ingest reverts when no feed is registered for the asset", async () => {
    const { router } = await loadFixture(deployWithSeq);
    const unknown = "0x2222222222222222222222222222222222222222";
    await expect(router.ingest(unknown, payloadFor(FEED))).to.be.revertedWithCustomError(
      router,
      "FeedNotSet"
    );
  });

  it("ingest is monotonic: equal timestamp ok, older reverts (anti-replay)", async () => {
    const { router, setReport, ingest } = await loadFixture(deployWithSeq);
    const now = await time.latest();
    await setReport(300n * ONE, 0n, 0n, now, V11.Regular);
    await ingest();
    // equal timestamp is allowed (guard is strictly-less-than)
    await setReport(301n * ONE, 0n, 0n, now, V11.Regular);
    await ingest();
    expect((await router.lastReading(ASSET)).price).to.equal(301n * ONE);
    // older is rejected
    await setReport(290n * ONE, 0n, 0n, now - 100, V11.Regular);
    await expect(ingest()).to.be.revertedWithCustomError(router, "RollbackReport");
  });

  it("reverts reading an asset that was never ingested", async () => {
    const { router } = await loadFixture(deployWithSeq);
    await expect(router.getPrice(ASSET)).to.be.revertedWithCustomError(router, "NoReading");
    await expect(router.lastReading(ASSET)).to.be.revertedWithCustomError(router, "NoReading");
  });
});

describe("OracleRouter — read-time gate", () => {
  it("passes through a fresh, open, sequencer-up reading as Open", async () => {
    const { setReport, ingest, router } = await loadFixture(deployWithSeq);
    await setReport(300n * ONE, 0n, 0n, await time.latest(), V11.Regular);
    await ingest();
    expect((await router.getPrice(ASSET)).marketStatus).to.equal(Status.Open);
  });

  it("Open + stale past threshold -> Halted (raw cache untouched)", async () => {
    const { setReport, ingest, router } = await loadFixture(deployWithSeq);
    const t = await time.latest();
    await setReport(300n * ONE, 0n, 0n, t, V11.Regular);
    await ingest();
    await time.increaseTo(t + HOUR + 10);
    expect((await router.getPrice(ASSET)).marketStatus).to.equal(Status.Halted);
    expect((await router.lastReading(ASSET)).marketStatus).to.equal(Status.Open); // gate does not mutate cache
  });

  it("staleness boundary: age == threshold stays Open, age > threshold halts", async () => {
    const { setReport, ingest, router } = await loadFixture(deployWithSeq);
    const t = await time.latest();
    await setReport(300n * ONE, 0n, 0n, t, V11.Regular);
    await ingest();
    await time.increaseTo(t + HOUR); // exactly at threshold
    expect((await router.getPrice(ASSET)).marketStatus).to.equal(Status.Open);
    await time.increaseTo(t + HOUR + 5);
    expect((await router.getPrice(ASSET)).marketStatus).to.equal(Status.Halted);
  });

  it("sequencer down -> Degraded; within grace -> Degraded", async () => {
    const { setReport, ingest, router, sequencer } = await loadFixture(deployWithSeq);
    await setReport(300n * ONE, 0n, 0n, await time.latest(), V11.Regular);
    await ingest();

    await sequencer.setStatus(1, 1); // down
    expect((await router.getPrice(ASSET)).marketStatus).to.equal(Status.Degraded);

    await sequencer.setStatus(0, await time.latest()); // just restarted -> grace
    expect((await router.getPrice(ASSET)).marketStatus).to.equal(Status.Degraded);
  });

  it("worst-of: a Closed market stays Closed even when the sequencer is down", async () => {
    const { setReport, ingest, router, sequencer } = await loadFixture(deployWithSeq);
    await setReport(300n * ONE, 0n, 0n, await time.latest(), V11.Closed);
    await ingest();
    await sequencer.setStatus(1, 1); // down (Degraded severity < Closed)
    expect((await router.getPrice(ASSET)).marketStatus).to.equal(Status.Closed);
  });

  it("with no sequencer feed the rail gate is disabled (fresh -> Open), staleness still applies", async () => {
    const { setReport, ingest, router } = await loadFixture(deployNoSeq);
    const t = await time.latest();
    await setReport(300n * ONE, 0n, 0n, t, V11.Regular);
    await ingest();
    expect((await router.getPrice(ASSET)).marketStatus).to.equal(Status.Open);
    await time.increaseTo(t + HOUR + 10);
    expect((await router.getPrice(ASSET)).marketStatus).to.equal(Status.Halted);
  });
});
