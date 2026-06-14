// Wire the L4/L5 oracle for EVERY catalog token the create-wizard offers, so a registry vault built
// from any of them can record + settle on-chain (not just the 3 scene stocks). Per token it sets:
//   • MockFeedRouter.setFeed(token, FEED_ID)        — clears g1 FeedNotSet
//   • PriceAggregator.addSource(token, weekday/weekend) — the 2 committee-signed sources (index 0/1,
//     the order the backend payload-builder assumes), so priceOf/navOf can produce a safe price
//   • PriceAggregator.addSource(token, sharedMock)  — the g1 source ref (setG1Refs)
// and ONCE: setCommittee([keeper], 1) on both signed sources (clears ThresholdNotMet) + relaxes the
// aggregator band params for the 2-synthetic-source testnet (so safe=true is achievable).
//
//   cd blockchain && npx hardhat run scripts/wire-catalog-oracle.ts --network robinhoodTestnet
//   LIMIT=50 ...                  # only the first 50 catalog tokens (faster partial run)
//   STOCKS=NVDA,AAPL,0x12ab.. ... # only these tickers/addresses
//   KEEPER_ADDRESS=0x..           # committee signer (defaults to the deployer = backend keeper)
//
// Idempotent + resumable: every check is a read first, so re-running only does the missing txs.
import { ethers } from "hardhat";
import { loadConfig, requireAddress, getDeployer } from "./deploy/_shared";

const FEED_ID = "0x" + "11".repeat(32); // mock router feed id (g1 only checks non-zero) — matches deploy-l5

async function main() {
  const { address: me } = await getDeployer();
  const config = loadConfig();
  const routerAddr = requireAddress(config, "MockFeedRouter", "deploy-l5.ts");
  const aggAddr = requireAddress(config, "PriceAggregator", "deploy-l4.ts");
  const weekday = requireAddress(config, "UniversalSignedSource", "deploy-l4.ts");
  const weekend = requireAddress(config, "UniversalSignedSourceWeekend", "deploy-l4.ts");
  const demo = (config.params?.["demo"] ?? {}) as {
    stocks?: Record<string, { address: string }>;
    scene?: { stocks?: string[] };
    sharedSource?: string;
  };
  const shared = config.deployments?.["Source_Shared"]?.address ?? demo.sharedSource;
  if (!shared) throw new Error("no shared MockSource (deployments.Source_Shared / params.demo.sharedSource)");

  const signer = process.env.KEEPER_ADDRESS ?? me;
  const router = await ethers.getContractAt("MockFeedRouter", routerAddr);
  const agg = await ethers.getContractAt("PriceAggregator", aggAddr);

  // Token set: every catalog stock (ticker-keyed) + the scene stocks, with optional subset/limit.
  let entries = Object.entries(demo.stocks ?? {}).map(([ticker, v]) => ({ ticker, address: v.address }));
  for (const a of demo.scene?.stocks ?? []) {
    if (!entries.some((e) => e.address.toLowerCase() === a.toLowerCase())) entries.push({ ticker: "scene", address: a });
  }
  if (process.env.STOCKS) {
    const want = new Set(process.env.STOCKS.split(",").map((s) => s.trim().toLowerCase()));
    entries = entries.filter((e) => want.has(e.ticker.toLowerCase()) || want.has(e.address.toLowerCase()));
  }
  if (process.env.LIMIT) entries = entries.slice(0, Number(process.env.LIMIT));
  console.log(`Wiring ${entries.length} catalog token(s). Committee signer: ${signer}\n`);

  // 1. Committee = backend keeper (1-of-1) on both signed sources — global, once.
  for (const [name, addr] of [
    ["UniversalSignedSource", weekday],
    ["UniversalSignedSourceWeekend", weekend],
  ] as const) {
    const src = await ethers.getContractAt("UniversalSignedSource", addr);
    if ((await src.isCommittee(signer)) && (await src.threshold()) === 1n) {
      console.log(`committee ${name} already 1-of-1 with ${signer}`);
    } else {
      await (await src.setCommittee([signer], 1)).wait();
      console.log(`committee ${name} -> setCommittee([${signer}], 1)`);
    }
  }

  // 2. Relax aggregator band for 2 synthetic same-committee sources (mirror configure-l4) — once.
  const [minSafe, curBand] = await Promise.all([agg.minSafeSources(), agg.maxSafeBandBps()]);
  if (minSafe !== 1n || curBand !== 10000n) {
    const [maxW, div, stale, dMin] = await Promise.all([
      agg.maxWeightBps(),
      agg.divergenceBps(),
      agg.staleHorizon(),
      agg.dMin(),
    ]);
    await (await agg.setParams(maxW, div, stale, dMin, 0, 0, 0, 10000, 1)).wait();
    console.log("aggregator -> wDisp/wDepth/wStale=0, maxSafeBandBps=10000, minSafeSources=1");
  } else {
    console.log("aggregator params already relaxed");
  }

  // 3. Per token: feed + signed sources (0=weekday, 1=weekend) + shared mock (g1 ref).
  let wired = 0;
  let already = 0;
  let txs = 0;
  for (let i = 0; i < entries.length; i++) {
    const { ticker, address: t } = entries[i]!;
    let did = false;
    try {
      if ((await router.feedIdOf(t)) === ethers.ZeroHash) {
        await (await router.setFeed(t, FEED_ID)).wait();
        txs++;
        did = true;
      }
      const sc: bigint = await agg.sourceCount(t);
      if (sc === 0n) {
        await (await agg.addSource(t, weekday)).wait();
        await (await agg.addSource(t, weekend)).wait();
        txs += 2;
        did = true;
      } else if (sc === 1n) {
        // assume the single source is the weekday at index 0 — append weekend to keep the order convention
        await (await agg.addSource(t, weekend)).wait();
        txs++;
        did = true;
      }
      if (!(await agg.isSource(t, shared))) {
        await (await agg.addSource(t, shared)).wait();
        txs++;
        did = true;
      }
    } catch (e) {
      console.log(`  [${i + 1}/${entries.length}] ${ticker.padEnd(6)} ${t} FAILED: ${(e as Error).message}`);
      continue;
    }
    if (did) {
      wired++;
      console.log(`  [${i + 1}/${entries.length}] ${ticker.padEnd(6)} ${t} wired`);
    } else {
      already++;
    }
  }

  console.log(`\n✅ DONE: ${wired} newly wired, ${already} already-set, ${txs} txs. These tokens are now record/settle-ready.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
