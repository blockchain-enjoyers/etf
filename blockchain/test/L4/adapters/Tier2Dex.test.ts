import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

describe("CurveSource", () => {
  async function deploy() {
    const Pool = await ethers.getContractFactory("MockCurvePool");
    const pool = await Pool.deploy();
    await pool.set(300n * ONE, 10_000_000n * ONE, 10_000_000n * ONE);
    const Src = await ethers.getContractFactory("CurveSource");
    const src = await Src.deploy(await pool.getAddress(), 100);
    return { pool, src };
  }
  it("EMA price from price_oracle; depth scales with balances", async () => {
    const { pool, src } = await loadFixture(deploy);
    const r = await src.read.staticCall("0x");
    expect(r.price).to.equal(300n * ONE);
    expect(r.kind).to.equal(1); // AMM_TWAP
    expect(r.healthy).to.equal(true);
    const deep = r.depth;
    await pool.set(300n * ONE, 1_000n * ONE, 1_000n * ONE);
    const thin = (await src.read.staticCall("0x")).depth;
    expect(thin).to.be.lessThan(deep);
  });
});

describe("UniswapV2Source", () => {
  async function deploy() {
    const Pair = await ethers.getContractFactory("MockUniswapV2Pair");
    const pair = await Pair.deploy();
    await pair.set(1_000_000n * ONE, 300_000_000n * ONE); // price = r1/r0 = 300
    const Src = await ethers.getContractFactory("UniswapV2Source");
    const src = await Src.deploy(await pair.getAddress(), 18, 18, 100);
    return { pair, src };
  }
  it("spot price from reserves; depth scales with reserves", async () => {
    const { pair, src } = await loadFixture(deploy);
    const r = await src.read.staticCall("0x");
    expect(r.price).to.equal(300n * ONE);
    expect(r.kind).to.equal(1);
    expect(r.healthy).to.equal(true);
    const deep = r.depth;
    await pair.set(1_000n * ONE, 300_000n * ONE);
    const thin = (await src.read.staticCall("0x")).depth;
    expect(thin).to.be.lessThan(deep);
  });
});

describe("UniswapV4Source", () => {
  async function deploy() {
    const Hook = await ethers.getContractFactory("MockV4Hook");
    const hook = await Hook.deploy();
    await hook.set(0, 1_000_000_000n);
    const Src = await ethers.getContractFactory("UniswapV4Source");
    const src = await Src.deploy(await hook.getAddress(), 300, 18, 18, 100);
    return { hook, src };
  }
  it("TWAP price from hook accumulator (tick 0 -> 1e18); depth scales with liquidity", async () => {
    const { hook, src } = await loadFixture(deploy);
    const r = await src.read.staticCall("0x");
    expect(r.price).to.be.closeTo(ONE, ONE / 1000n);
    expect(r.kind).to.equal(1);
    expect(r.healthy).to.equal(true);
    const deep = r.depth;
    await hook.set(0, 1_000_000n);
    const thin = (await src.read.staticCall("0x")).depth;
    expect(thin).to.be.lessThan(deep);
  });
});

describe("GmxV2Source", () => {
  async function deploy() {
    const Reader = await ethers.getContractFactory("MockGmxReader");
    const reader = await Reader.deploy();
    await reader.set(300n * ONE, 5_000_000n * ONE, 6_000_000n * ONE);
    const Src = await ethers.getContractFactory("GmxV2Source");
    const src = await Src.deploy(await reader.getAddress(), 100);
    return { reader, src };
  }
  it("mark price; PERP kind; depth scales with min OI", async () => {
    const { reader, src } = await loadFixture(deploy);
    const r = await src.read.staticCall("0x");
    expect(r.price).to.equal(300n * ONE);
    expect(r.kind).to.equal(2); // PERP
    expect(r.weekendAware).to.equal(false);
    expect(r.healthy).to.equal(true);
    const deep = r.depth;
    await reader.set(300n * ONE, 1_000n * ONE, 6_000_000n * ONE);
    const thin = (await src.read.staticCall("0x")).depth;
    expect(thin).to.be.lessThan(deep);
  });
});
