// L4 — the price layer (prod oracle is L4-only; the L2 cache stack was removed).
//   npx hardhat run scripts/deploy/deploy-l4.ts --network robinhoodTestnet
//
// PriceAggregator is the owned non-view multi-source hub; FairValueNAV reads it. Two reference price
// sources are deployed: ChainlinkStreamsSource (Data Streams verify-in-tx, v8/v11) and
// UniversalSignedSource (ecrecover committee).
//
// Testnet note: real Streams verify needs an off-chain DON report (a Streams API key we don't have),
// so the source points at MockVerifierProxy (setVerifyResult(bytes) -> verify) for an end-to-end NAV.
// The real RHC VerifierProxy is recorded in params.realVerifierProxy for a later swap. Per-constituent
// aggregator.addSource(asset, source) and UniversalSignedSource.setCommittee(...) are asset/governance
// steps, NOT infra — done separately per fund/demo.
import { ethers } from "hardhat";
import { ensure, getDeployer, loadConfig, saveConfig, DEFAULTS, EXPLORER } from "./_shared";

export async function deployL4() {
  console.log("== L4: PriceAggregator + FairValueNAV + signed-price sources ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();

  // Persist the params actually used (transparency + the real-verifier swap target).
  const p = { ...DEFAULTS, ...(config.params ?? {}) };
  config.params = p;
  saveConfig(config);

  // 1-2. Owned aggregation hub + NAV reader.
  const aggregator = await ensure(config, "PriceAggregator", [deployer], deployer);
  const fairValueNav = await ensure(config, "FairValueNAV", [aggregator], deployer);

  // 3-4. Testnet Streams stand-in (raw-bytes mock verifier) + the Data Streams source over it.
  const mockVerifier = await ensure(config, "MockVerifierProxy", [], deployer);
  const streamsSource = await ensure(
    config,
    "ChainlinkStreamsSource",
    [mockVerifier, p.schemaVersion, p.depthTier],
    deployer,
  );

  // 5. Universal ecrecover-committee source (committee set later via governance, not here).
  const signedSource = await ensure(config, "UniversalSignedSource", [deployer], deployer);

  // 6. Second instance for closed-market estimates: weekendAware=true means it survives the
  //    aggregator's liveness filter when US equities are closed, so marketStatus stays honest
  //    (weekday source stale -> Closed). Payload convention: source 0 = weekday, 1 = weekend.
  const weekendSource = await ensure(
    config,
    "UniversalSignedSource",
    [deployer],
    deployer,
    "UniversalSignedSourceWeekend",
  );
  const weekend = await ethers.getContractAt("UniversalSignedSource", weekendSource);
  if (!(await weekend.weekendAware())) {
    await (await weekend.setWeekendAware(true)).wait();
    console.log("  UniversalSignedSourceWeekend -> weekendAware=true");
  }

  console.log(`\n✅ L4 ready. Aggregator: ${EXPLORER}${aggregator}`);
  console.log(`   StreamsSource -> MockVerifierProxy ${mockVerifier}  (real: ${p.realVerifierProxy})`);
  console.log("   Next: scripts/configure-l4.ts (sources per constituent + committee + testnet params).");
  return { aggregator, fairValueNav, mockVerifier, streamsSource, signedSource, weekendSource };
}

if (require.main === module) {
  deployL4().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
