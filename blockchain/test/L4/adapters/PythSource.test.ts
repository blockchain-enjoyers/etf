import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const ID = ethers.id("TSLA");

async function deploy() {
  const Mock = await ethers.getContractFactory("MockPyth");
  const pyth = await Mock.deploy(60, 0); // validTimePeriod, singleUpdateFeeInWei=0 (FREE for now)
  const Src = await ethers.getContractFactory("PythSource");
  const src = await Src.deploy(await pyth.getAddress(), ID, 60, 1_000_000n * ONE); // (pyth, id, maxAge, kDepth)
  return { pyth, src };
}

async function updateData(pyth: any, price: bigint, conf: bigint, expo: number, ts: number) {
  return pyth.createPriceFeedUpdateData(ID, price, conf, expo, price, conf, ts, 0);
}

describe("PythSource", () => {
  it("updates + reads; scales by expo to 1e18; conf -> confidence + synthetic depth", async () => {
    const { pyth, src } = await loadFixture(deploy);
    const ts = await time.latest();
    const upd = await updateData(pyth, 300_00000000n, 50000000n, -8, ts); // 300.00000000, conf 0.5
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [[upd]]);
    const r = await src.read.staticCall(payload); // fee == 0, no value forwarded
    expect(r.price).to.equal(300n * ONE);
    expect(r.confidence).to.equal(ONE / 2n); // 0.5 scaled to 1e18
    expect(r.depth).to.be.greaterThan(0n); // k*price/conf
    expect(r.kind).to.equal(4); // ORACLE_PULL
    expect(r.healthy).to.equal(true);
  });

  it("non-positive price -> unhealthy, zero depth", async () => {
    const { pyth, src } = await loadFixture(deploy);
    const ts = await time.latest();
    const upd = await updateData(pyth, 0n, 50000000n, -8, ts);
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(["bytes[]"], [[upd]]);
    const r = await src.read.staticCall(payload);
    expect(r.price).to.equal(0n);
    expect(r.healthy).to.equal(false);
  });
});
