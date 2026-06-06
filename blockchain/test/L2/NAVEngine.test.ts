import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ONE, E6, HOUR, Status, V11, payloadFor, ns } from "./helpers";

// NAVEngine: read-only basket NAV over the vault's actual holdings, with a confidence band, a worst-of
// market status, and the `estimated` flag. Full stack (adapter -> router -> engine) + a real
// BasketVault funded directly. Router/adapter edge cases live in their own test files.

const FEED_TSLA = ethers.id("TSLA/USD-Streams-RegularHours");
const FEED_CASH = ethers.id("USDC/USD-Streams");

async function deployFixture() {
  const [deployer] = await ethers.getSigners();

  const Verifier = await ethers.getContractFactory("MockVerifierProxy");
  const verifier = await Verifier.deploy();
  const Seq = await ethers.getContractFactory("MockSequencerUptimeFeed");
  const sequencer = await Seq.deploy();
  const Adapter = await ethers.getContractFactory("ChainlinkAdapter");
  const adapter = await Adapter.deploy(await verifier.getAddress(), 11);
  const Router = await ethers.getContractFactory("OracleRouter");
  const router = await Router.deploy(
    await adapter.getAddress(),
    await sequencer.getAddress(),
    HOUR,
    HOUR,
    deployer.address
  );
  const Nav = await ethers.getContractFactory("NAVEngine");
  const nav = await Nav.deploy(await router.getAddress());

  // 18-dec stock + 6-dec cash leg (decimals normalization).
  const Tok = await ethers.getContractFactory("MockERC20Decimals");
  const tsla = await Tok.deploy("Tesla", "TSLA", 18);
  const cash = await Tok.deploy("USD Coin", "USDC", 6);

  const legs = [
    { addr: await tsla.getAddress(), tok: tsla, qty: ONE },
    { addr: await cash.getAddress(), tok: cash, qty: E6 },
  ].sort((a, b) => (BigInt(a.addr) < BigInt(b.addr) ? -1 : 1));

  const BV = await ethers.getContractFactory("BasketVault");
  const vault = await BV.deploy(legs.map((l) => l.addr), legs.map((l) => l.qty), ONE, "Basket", "BSK");
  const vaultAddr = await vault.getAddress();

  const tslaAddr = await tsla.getAddress();
  const cashAddr = await cash.getAddress();
  await tsla.mint(vaultAddr, 10n * ONE); // 10 TSLA
  await cash.mint(vaultAddr, 5000n * E6); // 5000 USDC
  await router.setFeed(tslaAddr, FEED_TSLA);
  await router.setFeed(cashAddr, FEED_CASH);

  async function setReport(feedId: string, mid: bigint, bid: bigint, ask: bigint, tsSec: number, status: number) {
    await verifier.setEquityReport(feedId, mid, bid, ask, ns(tsSec), status);
  }
  async function ingest(asset: string, feedId: string) {
    await router.ingest(asset, payloadFor(feedId));
  }

  return { deployer, verifier, sequencer, router, nav, tslaAddr, cashAddr, vault, vaultAddr, setReport, ingest };
}

type F = Awaited<ReturnType<typeof deployFixture>>;
// TSLA $300 (+/-0.5 band), USDC $1 (flat), both regular hours, fresh.
async function ingestHealthy(f: F, tslaTs?: number, cashTs?: number) {
  const now = await time.latest();
  await f.setReport(FEED_TSLA, 300n * ONE, 2995n * ONE / 10n, 3005n * ONE / 10n, tslaTs ?? now, V11.Regular);
  await f.setReport(FEED_CASH, ONE, ONE, ONE, cashTs ?? now, V11.Regular);
  await f.ingest(f.tslaAddr, FEED_TSLA);
  await f.ingest(f.cashAddr, FEED_CASH);
}

describe("NAVEngine — market-hours valuation", () => {
  it("sums holdings, normalizes decimals, carries a confidence band, status Open", async () => {
    const f = await loadFixture(deployFixture);
    await ingestHealthy(f);
    const r = await f.nav.navOf(f.vaultAddr);
    // 10 TSLA * $300 = 3000; 5000 USDC * $1 = 5000 => 8000e18 (decimals normalized)
    expect(r.nav).to.equal(8000n * ONE);
    expect(r.confidenceLower).to.equal(7995n * ONE); // TSLA -0.5 on 10 shares = -5
    expect(r.confidenceUpper).to.equal(8005n * ONE);
    expect(r.marketStatus).to.equal(Status.Open);
    expect(r.estimated).to.equal(false);
  });

  it("navPerShare divides NAV by supply (1e18-scaled)", async () => {
    const f = await loadFixture(deployFixture);
    await ingestHealthy(f);
    const supply = 100n * ONE;
    expect(await f.nav.navPerShare(f.vaultAddr, supply)).to.equal(80n * ONE); // 8000 / 100
    expect(await f.nav.navPerShare(f.vaultAddr, 0n)).to.equal(0n); // guard
  });

  it("timestamp is the OLDEST leg (the basket freshness floor)", async () => {
    const f = await loadFixture(deployFixture);
    const now = await time.latest();
    await ingestHealthy(f, now, now - 50);
    expect((await f.nav.navOf(f.vaultAddr)).timestamp).to.equal(BigInt(now - 50));
  });
});

describe("NAVEngine — worst-of status / estimated", () => {
  it("one closed leg makes the whole basket Closed + estimated (price still shown)", async () => {
    const f = await loadFixture(deployFixture);
    const now = await time.latest();
    await f.setReport(FEED_TSLA, 300n * ONE, 0n, 0n, now, V11.Closed);
    await f.setReport(FEED_CASH, ONE, ONE, ONE, now, V11.Regular);
    await f.ingest(f.tslaAddr, FEED_TSLA);
    await f.ingest(f.cashAddr, FEED_CASH);
    const r = await f.nav.navOf(f.vaultAddr);
    expect(r.marketStatus).to.equal(Status.Closed);
    expect(r.estimated).to.equal(true);
    expect(r.nav).to.equal(8000n * ONE);
  });

  it("a stale leg makes the basket Halted + estimated", async () => {
    const f = await loadFixture(deployFixture);
    const now = await time.latest();
    await ingestHealthy(f, now - 2 * HOUR, now); // TSLA stale, CASH fresh
    const r = await f.nav.navOf(f.vaultAddr);
    expect(r.marketStatus).to.equal(Status.Halted);
    expect(r.estimated).to.equal(true);
  });

  it("sequencer down degrades the whole basket", async () => {
    const f = await loadFixture(deployFixture);
    await ingestHealthy(f);
    await f.sequencer.setStatus(1, 1);
    const r = await f.nav.navOf(f.vaultAddr);
    expect(r.marketStatus).to.equal(Status.Degraded);
    expect(r.estimated).to.equal(true);
  });
});
