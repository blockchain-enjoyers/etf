import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, Kind, EMPTY } from "./helpers";

const ASSET = "0x1111111111111111111111111111111111111111";

async function deploy() {
  const [owner] = await ethers.getSigners();
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);
  const Mock = await ethers.getContractFactory("MockSource");
  async function add(price: bigint, depth: bigint, healthy = true) {
    const m = await Mock.deploy();
    await m.set(price, depth, BigInt(await time.latest()), Kind.AMM_TWAP, 0n, true, healthy);
    await agg.addSource(ASSET, await m.getAddress());
  }
  return { agg, add };
}

describe("PriceAggregator — acceptedDepthOf", () => {
  it("sums the depth of surviving (accepted) sources", async () => {
    const { agg, add } = await loadFixture(deploy);
    await add(300n * ONE, 4_000_000n * ONE);
    await add(300n * ONE, 6_000_000n * ONE);
    await add(300n * ONE, 1n * ONE, false); // unhealthy -> dropped, depth not counted
    expect(await agg.acceptedDepthOf(ASSET, [EMPTY, EMPTY, EMPTY])).to.equal(10_000_000n * ONE);
  });

  it("drops a stale (healthy but old) source", async () => {
    const { agg, add } = await loadFixture(deploy);
    await add(300n * ONE, 5_000_000n * ONE); // fresh, counted
    // stale: healthy=true but lastUpdate older than staleHorizon (3600s) -> dropped
    const Mock = await ethers.getContractFactory("MockSource");
    const m = await Mock.deploy();
    await m.set(300n * ONE, 9_000_000n * ONE, BigInt((await time.latest()) - 3601), Kind.AMM_TWAP, 0n, true, true);
    await agg.addSource(ASSET, await m.getAddress());
    expect(await agg.acceptedDepthOf(ASSET, [EMPTY, EMPTY])).to.equal(5_000_000n * ONE);
  });
});
