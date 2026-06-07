// L4 — the fair-value layer: PriceAggregator -> L2RouterSource -> FairValueNAV.
//
//   npx hardhat run scripts/deploy/deploy-l4.ts --network robinhoodTestnet
//
// Requires L2 (OracleRouter) to be deployed first — L2RouterSource reads prices from it. Run
// deploy-l2.ts (or deploy-all.ts) before this. PriceAggregator is the owned hub: register per-asset
// sources with addSource(asset, source) and tune bands/weights with setParams() post-deploy.
//
// L2RouterSource bridges the L2 oracle router into the aggregator as one IPriceSource; its depthTier
// is a governance-set synthetic depth (oracles have no pool), defaulting to 5,000,000 * 1e18.
// FairValueNAV is the read entrypoint (navOf / navWithBasketCheck) over the aggregator.
import { ensure, getDeployer, loadConfig, requireAddress, DEFAULTS, EXPLORER } from "./_shared";

export async function deployL4() {
  console.log("== L4: PriceAggregator + L2RouterSource + FairValueNAV ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();

  const router = requireAddress(config, "OracleRouter", "deploy-l2.ts");
  const depthTier = BigInt((config.params?.depthTier as string) ?? DEFAULTS.depthTier);

  // Owned aggregation hub (deployer is initial owner / governance).
  const aggregator = await ensure(config, "PriceAggregator", [deployer], deployer);

  // Oracle-backed price source, wired to the L2 router.
  const l2Source = await ensure(config, "L2RouterSource", [router, depthTier], deployer);

  // Fair-value NAV read entrypoint over the aggregator.
  const fairValueNav = await ensure(config, "FairValueNAV", [aggregator], deployer);

  console.log(`\n✅ L4 ready. Aggregator: ${EXPLORER}${aggregator}`);
  console.log(
    "   Next: aggregator.addSource(asset, l2Source) per constituent; optionally addSource() more " +
      "sources, then aggregator.setParams(...) to tune bands/weights.\n",
  );
  return { aggregator, l2Source, fairValueNav };
}

if (require.main === module) {
  deployL4().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
