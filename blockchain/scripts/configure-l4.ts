// Configure the L4 oracle stack for the demo constituents (replaces the L2-era configure-oracle.ts).
//
//   cd blockchain && npx hardhat run scripts/configure-l4.ts --network robinhoodTestnet
//
// Per token (idempotent): PriceAggregator.addSource(token, weekday) THEN addSource(token, weekend) —
// ORDER MATTERS: the backend payload builder assumes index 0 = weekday source, index 1 = weekend
// source. Then sets the backend keeper as a 1-of-1 committee on both UniversalSignedSource instances
// and relaxes the aggregator safety params for a 2-synthetic-source testnet. No prices are pushed:
// prices flow as committee-signed payloads supplied at read/tx time.
import { ethers } from "hardhat";
import { loadConfig, requireAddress, getDeployer } from "./deploy/_shared";

const TOKENS: { symbol: string; address: string }[] = [
  { symbol: "MSTR", address: "0x89eC78b779E00bc99044656b04a8DB059c9b7270" },
  { symbol: "TSLA", address: "0xB1EB0688FEA9011F38275a77b1BE7f2dCFb290C3" },
  { symbol: "NVDA", address: "0x1d2DC78A673E3040E188b2551DA2ec4785fB49a1" },
];

async function main() {
  const { address: me } = await getDeployer();
  const config = loadConfig();
  const aggAddr = requireAddress(config, "PriceAggregator", "deploy-l4.ts");
  const weekdayAddr = requireAddress(config, "UniversalSignedSource", "deploy-l4.ts");
  const weekendAddr = requireAddress(config, "UniversalSignedSourceWeekend", "deploy-l4.ts");

  const agg = await ethers.getContractAt("PriceAggregator", aggAddr);

  const signer = process.env.KEEPER_ADDRESS ?? me;
  console.log(`Committee signer: ${signer} (${process.env.KEEPER_ADDRESS ? "env KEEPER_ADDRESS" : "deployer"})`);

  console.log("== Register sources (0=weekday, 1=weekend — payload order convention) ==");
  for (const t of TOKENS) {
    const sc: bigint = await agg.sourceCount(t.address);
    if (sc === 0n) {
      await (await agg.addSource(t.address, weekdayAddr)).wait();
      await (await agg.addSource(t.address, weekendAddr)).wait();
      console.log(`  ${t.symbol.padEnd(5)} added weekday + weekend`);
    } else if (sc === 1n) {
      console.log(`  ${t.symbol.padEnd(5)} WARNING: 1 source already registered — assuming it is the weekday source at index 0, adding weekend only`);
      await (await agg.addSource(t.address, weekendAddr)).wait();
    } else {
      console.log(`  ${t.symbol.padEnd(5)} ${sc} sources already registered — skip`);
    }
  }

  console.log("== Committee (1-of-1 backend keeper) on both sources ==");
  for (const [name, addr] of [
    ["UniversalSignedSource", weekdayAddr],
    ["UniversalSignedSourceWeekend", weekendAddr],
  ] as const) {
    const src = await ethers.getContractAt("UniversalSignedSource", addr);
    if ((await src.isCommittee(signer)) && (await src.threshold()) === 1n) {
      console.log(`  ${name} already 1-of-1 with ${signer}`);
    } else {
      await (await src.setCommittee([signer], 1)).wait();
      console.log(`  ${name} -> setCommittee([${signer}], 1)`);
    }
  }

  // Two SYNTHETIC same-committee sources on this testnet -> make safe=true achievable with one
  // surviving source: zero the dispersion/depth/stale band penalties (the mock depth/age would
  // otherwise inflate the band) and accept a wide safe band. Mainnet would keep real penalties +
  // a tight band + minSafeSources>=2.
  const minSafe: bigint = await agg.minSafeSources();
  const curBand: bigint = await agg.maxSafeBandBps();
  if (minSafe !== 1n || curBand !== 10000n) {
    const [maxW, div, stale, dMin] = await Promise.all([
      agg.maxWeightBps(),
      agg.divergenceBps(),
      agg.staleHorizon(),
      agg.dMin(),
    ]);
    await (await agg.setParams(maxW, div, stale, dMin, 0, 0, 0, 10000, 1)).wait();
    console.log("  PriceAggregator -> wDisp/wDepth/wStale=0, maxSafeBandBps=10000, minSafeSources=1");
  } else {
    console.log("  PriceAggregator params already relaxed — skip");
  }

  console.log("\n== Summary ==");
  for (const t of TOKENS) {
    console.log(`  ${t.symbol.padEnd(5)} sources=${await agg.sourceCount(t.address)}`);
  }
  console.log(
    "\n✅ L4 configured. NOTE: no on-chain price storage — prices flow via committee-signed payloads at read time.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
