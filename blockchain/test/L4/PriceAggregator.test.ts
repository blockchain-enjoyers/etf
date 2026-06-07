import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, HOUR, Status, Kind, EMPTY } from "./helpers";

const ASSET = "0x1111111111111111111111111111111111111111";

async function deploy() {
  const [owner] = await ethers.getSigners();
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);
  const Mock = await ethers.getContractFactory("MockSource");
  async function newSource(
    price: bigint, depth: bigint, weekendAware = false, healthy = true, ageSec = 0
  ) {
    const m = await Mock.deploy();
    const now = await time.latest();
    await m.set(price, depth, BigInt(now - ageSec), Kind.AMM_TWAP, 0n, weekendAware, healthy);
    return m;
  }
  return { owner, agg, newSource };
}

describe("PriceAggregator — single source", () => {
  it("registers a source and passes a healthy fresh reading through", async () => {
    const { agg, newSource } = await loadFixture(deploy);
    const s = await newSource(300n * ONE, 1_000_000n * ONE);
    await agg.addSource(ASSET, await s.getAddress());
    const r = await agg.priceOf(ASSET, [EMPTY]);
    expect(r.price).to.equal(300n * ONE);
    expect(r.marketStatus).to.equal(Status.Open);
  });

  it("drops an unhealthy source -> Unknown, unsafe", async () => {
    const { agg, newSource } = await loadFixture(deploy);
    const s = await newSource(300n * ONE, 1_000_000n * ONE, false, false);
    await agg.addSource(ASSET, await s.getAddress());
    const r = await agg.priceOf(ASSET, [EMPTY]);
    expect(r.marketStatus).to.equal(Status.Unknown);
    expect(r.safe).to.equal(false);
  });

  it("drops a stale source past staleHorizon", async () => {
    const { agg, newSource } = await loadFixture(deploy);
    const s = await newSource(300n * ONE, 1_000_000n * ONE, false, true, HOUR + 10);
    await agg.addSource(ASSET, await s.getAddress());
    const r = await agg.priceOf(ASSET, [EMPTY]);
    expect(r.marketStatus).to.equal(Status.Unknown);
  });

  it("addSource is owner-only", async () => {
    const { agg, newSource } = await loadFixture(deploy);
    const [, other] = await ethers.getSigners();
    const s = await newSource(300n * ONE, 1_000_000n * ONE);
    await expect(
      agg.connect(other).addSource(ASSET, await s.getAddress())
    ).to.be.revertedWithCustomError(agg, "OwnableUnauthorizedAccount");
  });
});

describe("PriceAggregator — depth-weighted median + cap", () => {
  async function withSources(specs: Array<[bigint, bigint]>) {
    const { agg, newSource } = await loadFixture(deploy);
    const payloads: string[] = [];
    for (const [price, depth] of specs) {
      const s = await newSource(price, depth, false, true, 0);
      await agg.addSource(ASSET, await s.getAddress());
      payloads.push(EMPTY);
    }
    return { agg, payloads };
  }

  it("returns the depth-weighted median, not the mean (deep source wins)", async () => {
    // three sources: deep at 300, two thin at 250 and 350 -> median crosses on the deep 300
    const { agg, payloads } = await withSources([
      [300n * ONE, 10_000_000n * ONE],
      [250n * ONE, 100n * ONE],
      [350n * ONE, 100n * ONE],
    ]);
    const r = await agg.priceOf(ASSET, payloads);
    expect(r.price).to.equal(300n * ONE);
  });

  it("weight cap stops one fat source from being the whole median", async () => {
    // one source claims enormous depth at a manipulated 1000; two honest deep sources at 300/301.
    // With a 40% cap the fat source cannot alone cross 50% -> median lands on an honest price.
    const { agg, payloads } = await withSources([
      [1000n * ONE, 1_000_000_000n * ONE],
      [300n * ONE, 10_000_000n * ONE],
      [301n * ONE, 10_000_000n * ONE],
    ]);
    const r = await agg.priceOf(ASSET, payloads);
    expect(r.price).to.be.lessThan(400n * ONE); // not dragged to 1000
  });
});

describe("PriceAggregator — divergence, band, ladder", () => {
  async function withSources(specs: Array<[bigint, bigint]>) {
    const { agg, newSource } = await loadFixture(deploy);
    const payloads: string[] = [];
    for (const [price, depth] of specs) {
      const s = await newSource(price, depth, false, true, 0);
      await agg.addSource(ASSET, await s.getAddress());
      payloads.push(EMPTY);
    }
    return { agg, payloads };
  }

  it("rejects an outlier beyond the divergence band before the median", async () => {
    // 300/301 honest deep, plus a 500 outlier > 2% from the provisional median -> dropped.
    const { agg, payloads } = await withSources([
      [300n * ONE, 10_000_000n * ONE],
      [301n * ONE, 10_000_000n * ONE],
      [500n * ONE, 10_000_000n * ONE],
    ]);
    const r = await agg.priceOf(ASSET, payloads);
    expect(r.price).to.be.lessThan(310n * ONE); // outlier excluded
    expect(r.safe).to.equal(true); // 2 honest survivors, tight band
  });

  it("agreeing deep sources -> tight band, safe=true", async () => {
    const { agg, payloads } = await withSources([
      [300n * ONE, 10_000_000n * ONE],
      [300n * ONE, 10_000_000n * ONE],
      [300n * ONE, 10_000_000n * ONE],
    ]);
    const r = await agg.priceOf(ASSET, payloads);
    expect(r.safe).to.equal(true);
    expect(r.confUpper - r.confLower).to.be.lessThan(30n * ONE); // < 5% of 300
  });

  it("single thin survivor -> band blows out, safe=false", async () => {
    const { agg, payloads } = await withSources([[300n * ONE, 1n * ONE]]);
    const r = await agg.priceOf(ASSET, payloads);
    expect(r.safe).to.equal(false); // below minSafeSources AND thin depth penalty
    expect(r.confUpper).to.be.greaterThan(r.price); // non-zero band
  });
});
