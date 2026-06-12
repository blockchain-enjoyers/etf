import { expect } from "chai";
import { ethers } from "hardhat";
import { buildUniversalPayload } from "../keeper/sign";

// SourceKind enum (contracts/L4/IPriceSource.sol):
// AMM_SPOT=0, AMM_TWAP=1, PERP=2, ORACLE_PUSH=3, ORACLE_PULL=4, RWA_STREAM=5
const SOURCE_KIND_ORACLE_PULL = 4;

describe("demo fund integration", () => {
  it("safe=true with 2 fresh signed sources; manipulation pump is rejected by the median", async () => {
    const [owner] = await ethers.getSigners();

    const Agg = await ethers.getContractFactory("PriceAggregator");
    const agg = await Agg.deploy(owner.address);
    await agg.waitForDeployment();

    const Src = await ethers.getContractFactory("UniversalSignedSource");
    const weekday = await Src.deploy(owner.address);
    const weekend = await Src.deploy(owner.address);
    await weekday.waitForDeployment();
    await weekend.waitForDeployment();
    await (await weekend.setWeekendAware(true)).wait();

    const k1 = ethers.Wallet.createRandom();
    const k2 = ethers.Wallet.createRandom();
    const committee = [k1.address, k2.address].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    await (await weekday.setCommittee(committee, 2)).wait();
    await (await weekend.setCommittee(committee, 2)).wait();

    const asset = ethers.Wallet.createRandom().address; // stand-in token address
    await (await agg.addSource(asset, await weekday.getAddress())).wait();
    await (await agg.addSource(asset, await weekend.getAddress())).wait();

    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    const rep = { feedId: ethers.id("AAPL"), price: 200n * 10n ** 18n, depth: 5_000_000n * 10n ** 18n, lastUpdate: now };
    const payload = await buildUniversalPayload(rep, [k1.privateKey, k2.privateKey]);

    const res = await agg.priceOf.staticCall(asset, [payload, payload]);
    expect(res.safe).to.equal(true);
    expect(res.price).to.equal(rep.price);

    // manipulation: a thin MockSource pumped x25; median weight-cap + divergence band reject it.
    const Mock = await ethers.getContractFactory("MockSource");
    const thin = await Mock.deploy();
    await thin.waitForDeployment();
    // MockSource.set(price, depth, lastUpdate, kind, confidence, weekendAware, healthy)
    await (
      await thin.set(rep.price * 25n, 1n, now, SOURCE_KIND_ORACLE_PULL, 0, false, true)
    ).wait();
    await (await agg.addSource(asset, await thin.getAddress())).wait();

    const res2 = await agg.priceOf.staticCall(asset, [payload, payload, "0x"]);
    expect(res2.price).to.be.lt(rep.price * 2n); // pumped outlier did NOT move the median materially
    // tighter check: the divergence band drops the x25 outlier entirely, so the median stays at 200e18.
    expect(res2.price).to.equal(rep.price);
  });
});
