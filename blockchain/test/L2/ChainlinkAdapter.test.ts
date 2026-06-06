import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, Status, V11, V8, payloadFor, ns } from "./helpers";

// Unit tests for the only vendor-aware contract: it verifies a (mock) Data Streams report and
// normalizes it into our OracleReading. verifyAndNormalize is non-view (verify() mutates state), so we
// read its return value via staticCall.

const FEED = ethers.id("TSLA/USD-Streams-RegularHours");

async function deployAdapter(schemaVersion: number) {
  const Verifier = await ethers.getContractFactory("MockVerifierProxy");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();

  const Adapter = await ethers.getContractFactory("ChainlinkAdapter");
  const adapter = await Adapter.deploy(await verifier.getAddress(), schemaVersion);
  await adapter.waitForDeployment();

  return { verifier, adapter, Adapter };
}
const deployV11 = () => deployAdapter(11);
const deployV8 = () => deployAdapter(8);

// One verifier + both adapters, to compare v8 vs v11 mapping of the SAME report in one test
// (avoid two loadFixture calls in a single test — the second would revert the first).
async function deployBoth() {
  const Verifier = await ethers.getContractFactory("MockVerifierProxy");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const Adapter = await ethers.getContractFactory("ChainlinkAdapter");
  const adapterV8 = await Adapter.deploy(await verifier.getAddress(), 8);
  const adapterV11 = await Adapter.deploy(await verifier.getAddress(), 11);
  await adapterV8.waitForDeployment();
  await adapterV11.waitForDeployment();
  return { verifier, adapterV8, adapterV11 };
}

describe("ChainlinkAdapter — construction", () => {
  it("rejects an unsupported schema version", async () => {
    const Verifier = await ethers.getContractFactory("MockVerifierProxy");
    const verifier = await Verifier.deploy();
    const Adapter = await ethers.getContractFactory("ChainlinkAdapter");
    await expect(Adapter.deploy(await verifier.getAddress(), 4)).to.be.revertedWithCustomError(
      Adapter,
      "UnsupportedSchema"
    );
  });

  it("accepts v8 and v11 and reports the Chainlink source tag (1)", async () => {
    const { adapter } = await loadFixture(deployV11);
    expect(await adapter.schemaVersion()).to.equal(11);
    expect(await adapter.source()).to.equal(1);
  });
});

describe("ChainlinkAdapter — normalization (v11)", () => {
  it("maps mid->price, (ask-bid)/2->confidence, ns->seconds, feedId, source", async () => {
    const { verifier, adapter } = await loadFixture(deployV11);
    const tsSec = 1_700_000_000;
    await verifier.setEquityReport(FEED, 300n * ONE, 2995n * ONE / 10n, 3005n * ONE / 10n, ns(tsSec), V11.Regular);

    const r = await adapter.verifyAndNormalize.staticCall(payloadFor(FEED), FEED);
    expect(r.price).to.equal(300n * ONE);
    expect(r.confidence).to.equal(ONE / 2n); // (300.5 - 299.5)/2 = 0.5
    expect(r.timestamp).to.equal(BigInt(tsSec));
    expect(r.marketStatus).to.equal(Status.Open);
    expect(r.source).to.equal(1);
  });

  it("yields zero confidence when there is no two-sided book", async () => {
    const { verifier, adapter } = await loadFixture(deployV11);
    await verifier.setEquityReport(FEED, 300n * ONE, 0n, 0n, ns(1_700_000_000), V11.Regular);
    const r = await adapter.verifyAndNormalize.staticCall(payloadFor(FEED), FEED);
    expect(r.confidence).to.equal(0n);
  });

  it("maps every v11 session: 1..4 -> Open, 5 -> Closed, 0 -> Unknown", async () => {
    const { verifier, adapter } = await loadFixture(deployV11);
    const cases: [number, bigint][] = [
      [V11.Unknown, Status.Unknown],
      [V11.Pre, Status.Open],
      [V11.Regular, Status.Open],
      [V11.Post, Status.Open],
      [V11.Overnight, Status.Open],
      [V11.Closed, Status.Closed],
    ];
    for (const [raw, expected] of cases) {
      await verifier.setEquityReport(FEED, 300n * ONE, 0n, 0n, ns(1_700_000_000), raw);
      const r = await adapter.verifyAndNormalize.staticCall(payloadFor(FEED), FEED);
      expect(r.marketStatus, `v11 status ${raw}`).to.equal(expected);
    }
  });

  it("reverts on feedId mismatch and on non-positive mid", async () => {
    const { verifier, adapter } = await loadFixture(deployV11);
    await verifier.setEquityReport(FEED, 300n * ONE, 0n, 0n, ns(1_700_000_000), V11.Regular);
    // expected feed differs from the report's feedId
    await expect(
      adapter.verifyAndNormalize.staticCall(payloadFor(FEED), ethers.id("OTHER"))
    ).to.be.revertedWithCustomError(adapter, "FeedIdMismatch");

    await verifier.setEquityReport(FEED, 0n, 0n, 0n, ns(1_700_000_000), V11.Regular);
    await expect(
      adapter.verifyAndNormalize.staticCall(payloadFor(FEED), FEED)
    ).to.be.revertedWithCustomError(adapter, "NonPositivePrice");
  });
});

describe("ChainlinkAdapter — normalization (v8 mapping differs)", () => {
  it("maps v8: 2 -> Open, 1 -> Closed, others -> Unknown", async () => {
    const { verifier, adapter } = await loadFixture(deployV8);
    const cases: [number, bigint][] = [
      [V8.Open, Status.Open], // 2
      [V8.Closed, Status.Closed], // 1
      [V8.Unknown, Status.Unknown], // 0
      [3, Status.Unknown], // v8 has no 3
    ];
    for (const [raw, expected] of cases) {
      await verifier.setEquityReport(FEED, 300n * ONE, 0n, 0n, ns(1_700_000_000), raw);
      const r = await adapter.verifyAndNormalize.staticCall(payloadFor(FEED), FEED);
      expect(r.marketStatus, `v8 status ${raw}`).to.equal(expected);
    }
  });

  it("the SAME raw status 1 maps to Closed under v8 but Open (Pre) under v11", async () => {
    const { verifier, adapterV8, adapterV11 } = await loadFixture(deployBoth);
    await verifier.setEquityReport(FEED, 300n * ONE, 0n, 0n, ns(1_700_000_000), 1);
    expect((await adapterV8.verifyAndNormalize.staticCall(payloadFor(FEED), FEED)).marketStatus).to.equal(Status.Closed);
    expect((await adapterV11.verifyAndNormalize.staticCall(payloadFor(FEED), FEED)).marketStatus).to.equal(Status.Open);
  });
});
