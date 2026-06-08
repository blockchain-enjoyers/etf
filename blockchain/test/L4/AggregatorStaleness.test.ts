import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const ASSET = "0x1111111111111111111111111111111111111111";
const EMPTY = "0x";

async function deploy() {
  const [owner] = await ethers.getSigners();
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);
  const Mock = await ethers.getContractFactory("MockSource");
  async function add(ageSec: number) {
    const m = await Mock.deploy();
    const now = await time.latest();
    await m.set(300n * ONE, 10_000_000n * ONE, BigInt(now - ageSec), 1, 0n, false, true);
    await agg.addSource(ASSET, await m.getAddress());
    return m;
  }
  return { agg, add };
}

describe("PriceAggregator — staleness widens the band (EP-1)", () => {
  it("a near-stale (but not dropped) survivor gives a wider band than a fresh one", async () => {
    // staleHorizon default (3600s) is large enough that a 50-min-old source survives but is 'older'
    const f1 = await loadFixture(deploy);
    await f1.add(0);
    await f1.add(0);
    const fresh = await f1.agg.priceOf.staticCall(ASSET, [EMPTY, EMPTY]);

    const f2 = await loadFixture(deploy);
    await f2.add(0);
    await f2.add(3000); // one survivor 50 min old
    const stale = await f2.agg.priceOf.staticCall(ASSET, [EMPTY, EMPTY]);

    expect(stale.confUpper - stale.confLower).to.be.greaterThan(fresh.confUpper - fresh.confLower);
  });
});
