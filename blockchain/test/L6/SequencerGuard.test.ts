import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("SequencerGuard", () => {
  async function deploy() {
    const Feed = await ethers.getContractFactory("MockSequencerUptimeFeed");
    const feed = await Feed.deploy();
    const Guard = await ethers.getContractFactory("SequencerGuard");
    const guard = await Guard.deploy(await feed.getAddress(), true); // required = true
    return { guard, feed };
  }

  it("is up only when answer==0 AND past the grace window", async () => {
    const { guard, feed } = await loadFixture(deploy);
    const now = await time.latest();
    // Up, but came back 50s ago -> still in a 100s grace window -> not up yet.
    await feed.set(0, now - 50);
    expect(await guard.isUp(100)).to.equal(false);
    // Up and past the grace window.
    await feed.set(0, now - 200);
    expect(await guard.isUp(100)).to.equal(true);
    // Down -> never up regardless of grace.
    await feed.set(1, now - 5000);
    expect(await guard.isUp(100)).to.equal(false);
  });

  it("a zero feed with required=false disables the gate (explicit governance choice)", async () => {
    const Guard = await ethers.getContractFactory("SequencerGuard");
    const guard = await Guard.deploy(ethers.ZeroAddress, false);
    expect(await guard.isUp(100)).to.equal(true);
  });

  it("a zero feed with required=true reverts at construction (no silent disable)", async () => {
    const Guard = await ethers.getContractFactory("SequencerGuard");
    await expect(Guard.deploy(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
      Guard,
      "SequencerFeedMissing"
    );
  });
});
