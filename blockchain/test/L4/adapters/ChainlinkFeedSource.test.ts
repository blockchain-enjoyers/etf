import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

async function deploy() {
  const Feed = await ethers.getContractFactory("MockAggregatorV3");
  const feed = await Feed.deploy(8); // 8-decimal USD feed
  const Src = await ethers.getContractFactory("ChainlinkFeedSource");
  const src = await Src.deploy(await feed.getAddress(), 8, 5_000_000n * ONE, 3600); // (feed, dec, depthTier, maxAge)
  return { feed, src };
}

describe("ChainlinkFeedSource — classic Data Feeds (latestRoundData)", () => {
  it("scales the answer to 1e18 and is healthy when fresh", async () => {
    const { feed, src } = await loadFixture(deploy);
    await feed.set(300_00000000n, await time.latest()); // 300.00000000 @ 8 dec
    const r = await src.read.staticCall("0x");
    expect(r.price).to.equal(300n * ONE);
    expect(r.kind).to.equal(3); // ORACLE_PUSH
    expect(r.weekendAware).to.equal(false);
    expect(r.healthy).to.equal(true);
  });

  it("unhealthy when updatedAt is stale past maxAge", async () => {
    const { feed, src } = await loadFixture(deploy);
    await feed.set(300_00000000n, (await time.latest()) - 3601);
    const r = await src.read.staticCall("0x");
    expect(r.healthy).to.equal(false);
  });

  it("unhealthy on non-positive answer", async () => {
    const { feed, src } = await loadFixture(deploy);
    await feed.set(0n, await time.latest());
    const r = await src.read.staticCall("0x");
    expect(r.healthy).to.equal(false);
  });
});
