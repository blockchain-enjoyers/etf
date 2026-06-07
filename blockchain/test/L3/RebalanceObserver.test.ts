import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const ASSET = "0x1111111111111111111111111111111111111111";

async function deploy() {
  const [owner] = await ethers.getSigners();
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);
  const Mock = await ethers.getContractFactory("MockSource");
  const s1 = await Mock.deploy(); const s2 = await Mock.deploy();
  const now = await time.latest();
  for (const s of [s1, s2]) await s.set(300n * ONE, 10_000_000n * ONE, BigInt(now), 1, 0n, true, true);
  await agg.addSource(ASSET, await s1.getAddress());
  await agg.addSource(ASSET, await s2.getAddress());
  const Obs = await ethers.getContractFactory("RebalanceObserver");
  const obs = await Obs.deploy(await agg.getAddress());
  return { agg, obs, s1, s2 };
}

describe("RebalanceObserver", () => {
  it("accumulates the robust L4 price and returns a TWAP over the window", async () => {
    const { obs, s1, s2 } = await loadFixture(deploy);
    const P = ["0x", "0x"];
    await obs.record(ASSET, P);
    await time.increase(100);
    const t = await time.latest();
    await s1.setPrice(330n * ONE); await s1.setLastUpdate(t);
    await s2.setPrice(330n * ONE); await s2.setLastUpdate(t);
    await obs.record(ASSET, P);
    await time.increase(100);
    await obs.record(ASSET, P);
    const [twap, count] = await obs.consult(ASSET, 250);
    expect(count).to.be.greaterThanOrEqual(2n);
    expect(twap).to.be.greaterThan(300n * ONE);
    expect(twap).to.be.lessThanOrEqual(330n * ONE);
  });
});
