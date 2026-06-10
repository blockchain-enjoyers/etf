import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
const ONE = 10n ** 18n;
const coder = ethers.AbiCoder.defaultAbiCoder();
const FEED = ethers.id("TSLA-stream");

async function deploy() {
  const [owner] = await ethers.getSigners();
  // real aggregator + a NON-VIEW Chainlink Streams source
  const Agg = await ethers.getContractFactory("PriceAggregator");
  const agg = await Agg.deploy(owner.address);
  const V = await ethers.getContractFactory("MockVerifierProxy");
  const verifier = await V.deploy();
  const S = await ethers.getContractFactory("ChainlinkStreamsSource");
  const src = await S.deploy(await verifier.getAddress(), 11, 5_000_000n * ONE);
  const tok = await (await ethers.getContractFactory("MockERC20Decimals")).deploy("S", "S", 18);
  await agg.addSource(await tok.getAddress(), await src.getAddress());
  // a v11 report: mid=300e18, bid/ask tight, Regular(2), fresh
  const tsNs = BigInt(await time.latest()) * 10n ** 9n;
  await verifier.setVerifyResult(coder.encode(
    ["tuple(bytes32,uint32,uint32,uint192,uint192,uint32,int192,int192,int192,int192,int192,int192,uint32,uint64)"],
    [[FEED, 0, 0, 0, 0, 0, 300n * ONE, 299n * ONE, 0n, 301n * ONE, 0n, 0n, 2, tsNs]]));
  const Nav = await ethers.getContractFactory("FairValueNAV");
  const nav = await Nav.deploy(await agg.getAddress());
  const vault = await (await ethers.getContractFactory("MockHoldingsVault")).deploy();
  await vault.setHoldings(await tok.getAddress(), 2n * ONE);
  await tok.mint(await vault.getAddress(), 200n * ONE); // inflated ERC20 must NOT count
  const obs = await (await ethers.getContractFactory("BasketNavObserver")).deploy(await nav.getAddress());
  return { tok, nav, vault, obs };
}

describe("real engine regression (F1 + F2)", () => {
  it("non-view source + claim vault: observer.record does not brick, NAV is claim-backed", async () => {
    const { tok, nav, vault, obs } = await loadFixture(deploy);
    // F1: a non-view source through the (now non-view) seam must not STATICCALL-revert
    await expect(obs.record(await vault.getAddress(), [await tok.getAddress()], [["0x"]])).to.not.be.reverted;
    // F2: NAV uses holdingsOf (2e18), not inflated ERC20 (200e18)
    const r = await nav.navOfHoldings.staticCall(await vault.getAddress(), [await tok.getAddress()], [["0x"]]);
    expect(r.nav).to.equal(600n * ONE); // 2e18 * 300e18/1e18
  });
});
