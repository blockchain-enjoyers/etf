import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

async function deploy() {
  const Pool = await ethers.getContractFactory("MockUniswapV3Pool");
  const pool = await Pool.deploy();
  // tick 0 -> price 1.0 (1e18); both tokens 18 dec, base=token0, quote=token1
  await pool.set(0, 1_000_000_000n, 600); // liquidity, cardinality 600
  const Src = await ethers.getContractFactory("UniswapV3Source");
  // (pool, window=300s, base18, quote18, depthDeltaBps=100 (1%))
  const src = await Src.deploy(await pool.getAddress(), 300, 18, 18, 100);
  return { pool, src };
}

describe("UniswapV3Source", () => {
  it("derives the TWAP price from the mean tick (tick 0 -> 1e18)", async () => {
    const { src } = await loadFixture(deploy);
    const r = await src.read.staticCall("0x");
    expect(r.price).to.be.closeTo(ONE, ONE / 1000n);
    expect(r.kind).to.equal(1); // AMM_TWAP
    expect(r.weekendAware).to.equal(false);
    expect(r.healthy).to.equal(true);
  });

  it("depth (cost-to-move) scales with liquidity", async () => {
    const { pool, src } = await loadFixture(deploy);
    const deep = (await src.read.staticCall("0x")).depth;
    await pool.set(0, 1_000_000n, 600); // 1000x thinner
    const thin = (await src.read.staticCall("0x")).depth;
    expect(thin).to.be.lessThan(deep);
    expect(deep).to.be.greaterThan(0n);
  });

  it("unhealthy when cardinality below the window/blocktime floor", async () => {
    const { pool, src } = await loadFixture(deploy);
    await pool.set(0, 1_000_000_000n, 1); // cardinality 1 << 300/2
    const r = await src.read.staticCall("0x");
    expect(r.healthy).to.equal(false);
  });

  it("non-zero tick resolves to a positive price (no overflow on real ticks)", async () => {
    const { pool, src } = await loadFixture(deploy);
    await pool.set(60000, 1_000_000_000n, 600); // a large-ish tick
    const r = await src.read.staticCall("0x");
    expect(r.price).to.be.greaterThan(0n);
    expect(r.healthy).to.equal(true);
  });
});
