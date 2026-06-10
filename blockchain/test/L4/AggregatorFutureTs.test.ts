import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
const ONE = 10n ** 18n;
const ASSET = "0x2222222222222222222222222222222222222222";

async function deploy() {
  const [owner] = await ethers.getSigners();
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);
  const Mock = await ethers.getContractFactory("MockSource");
  const good = await Mock.deploy();
  const future = await Mock.deploy();
  const now = await time.latest();
  await good.set(300n * ONE, 10_000_000n * ONE, BigInt(now), 1, 0n, false, true);
  await future.set(300n * ONE, 10_000_000n * ONE, BigInt(now + 3600), 1, 0n, false, true); // 1h in the FUTURE
  await agg.addSource(ASSET, await good.getAddress());
  await agg.addSource(ASSET, await future.getAddress());
  return { agg };
}

describe("PriceAggregator tolerates a future-dated source (F3)", () => {
  it("does not underflow-revert; aggregates the good source", async () => {
    const { agg } = await loadFixture(deploy);
    const r = await agg.priceOf.staticCall(ASSET, ["0x", "0x"]);
    expect(r.price).to.equal(300n * ONE);
  });
});
