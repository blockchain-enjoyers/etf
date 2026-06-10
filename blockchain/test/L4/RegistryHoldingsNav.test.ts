import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const EMPTY = "0x";

// vault.holdingsOf(token) returns the CLAIM backing (e.g. 2e18), while IERC20(token).balanceOf(vault)
// is inflated by staged AP inventory (e.g. 200e18). FairValueNAV must use holdingsOf.
async function deploy() {
  const [owner] = await ethers.getSigners();
  const T = await ethers.getContractFactory("MockERC20Decimals");
  const tok = await T.deploy("S", "S", 18);
  // a real PriceAggregator with a single source @ price 1e18 (the plan's MockAggregator is the g1
  // isSource stand-in and has no priceOf; FairValueNAV needs the real aggregator)
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);
  const Mock = await ethers.getContractFactory("MockSource");
  const m = await Mock.deploy();
  await m.set(ONE, 10_000_000n * ONE, BigInt(await time.latest()), 1, 0n, false, true);
  await agg.addSource(await tok.getAddress(), await m.getAddress());

  const Nav = await ethers.getContractFactory("FairValueNAV");
  const nav = await Nav.deploy(await agg.getAddress());
  const Vault = await ethers.getContractFactory("MockHoldingsVault");
  const vault = await Vault.deploy();
  await vault.setHoldings(await tok.getAddress(), 2n * ONE);     // true claim backing
  await tok.mint(await vault.getAddress(), 200n * ONE);          // inflated ERC20 (staged AP inventory)
  return { tok, agg, nav, vault };
}

describe("FairValueNAV uses holdingsOf, not ERC20 balanceOf (F2)", () => {
  it("values a registry-style vault by its claim backing", async () => {
    const { tok, nav, vault } = await loadFixture(deploy);
    const r = await nav.navOfHoldings.staticCall(await vault.getAddress(), [await tok.getAddress()], [[EMPTY]]);
    expect(r.nav).to.equal(2n * ONE); // 2e18 * price(1e18)/1e18 — NOT 200e18
  });
});
