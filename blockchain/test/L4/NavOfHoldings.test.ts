import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, Kind, EMPTY } from "./helpers";

async function deploy() {
  const [owner, vault] = await ethers.getSigners();
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);
  const Mock = await ethers.getContractFactory("MockSource");
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const a = await Tok.deploy("A","A",18); const b = await Tok.deploy("B","B",18);

  async function addSource(asset: string, price: bigint) {
    // two identical sources so the aggregate is safe (k>=2, zero dispersion)
    for (let i = 0; i < 2; i++) {
      const m = await Mock.deploy();
      await m.set(price, 10_000_000n * ONE, BigInt(await time.latest()), Kind.AMM_TWAP, 0n, false, true);
      await agg.addSource(asset, await m.getAddress());
    }
  }
  await addSource(await a.getAddress(), 100n * ONE);
  await addSource(await b.getAddress(), 50n * ONE);

  // vault holds 3 A + 4 B
  await a.mint(vault.address, 3n * ONE);
  await b.mint(vault.address, 4n * ONE);

  const Nav = await ethers.getContractFactory("FairValueNAV");
  const nav = await Nav.deploy(await agg.getAddress());
  return { nav, a, b, vault };
}

describe("FairValueNAV — navOfHoldings", () => {
  it("values live balances at the aggregated price (sum of balance*price)", async () => {
    const { nav, a, b, vault } = await loadFixture(deploy);
    const tokens = [await a.getAddress(), await b.getAddress()];
    const payloads = [[EMPTY, EMPTY], [EMPTY, EMPTY]];
    const res = await nav.navOfHoldings(vault.address, tokens, payloads);
    // 3*100 + 4*50 = 500 (1e18 scaled)
    expect(res.nav).to.equal(500n * ONE);
    expect(res.safe).to.equal(true);
  });
});
