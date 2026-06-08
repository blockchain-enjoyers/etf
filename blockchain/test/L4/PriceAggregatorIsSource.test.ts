import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// Direct unit test for PriceAggregator.isSource (consumed by the L5 settle gate g1).
async function deploy() {
  const [owner] = await ethers.getSigners();
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);
  const Src = await ethers.getContractFactory("MockSource");
  const src = await Src.deploy();
  const asset = ethers.Wallet.createRandom().address;
  return { owner, agg, src, asset };
}

describe("PriceAggregator.isSource", () => {
  it("returns true for a registered (asset, src) pair", async () => {
    const { agg, src, asset } = await loadFixture(deploy);
    await agg.addSource(asset, await src.getAddress());
    expect(await agg.isSource(asset, await src.getAddress())).to.equal(true);
  });

  it("returns false for an unregistered source on the same asset", async () => {
    const { agg, asset } = await loadFixture(deploy);
    const other = ethers.Wallet.createRandom().address;
    expect(await agg.isSource(asset, other)).to.equal(false);
  });

  it("returns false for a registered source under a DIFFERENT asset", async () => {
    const { agg, src, asset } = await loadFixture(deploy);
    await agg.addSource(asset, await src.getAddress());
    const otherAsset = ethers.Wallet.createRandom().address;
    expect(await agg.isSource(otherAsset, await src.getAddress())).to.equal(false);
  });
});
