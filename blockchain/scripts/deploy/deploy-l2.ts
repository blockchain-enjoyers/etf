// L2 — the read-price stack: oracle infra -> OracleRouter -> NAVEngine.
//
//   npx hardhat run scripts/deploy/deploy-l2.ts --network robinhoodTestnet
//
// On the Robinhood testnet there is no live Chainlink Data Streams verifier or L2 sequencer feed,
// so we stand up the MOCKS (MockVerifierProxy + MockSequencerUptimeFeed) and the production
// ChainlinkAdapter over them. The whole stack then runs end-to-end today; swap the verifier/feed
// for real addresses later by setting REDEPLOY=1 after editing config, or re-pointing the adapter.
//
// Tunables come from config.params (falling back to DEFAULTS): schemaVersion (11), grace period and
// staleness threshold (3600s each). CommitmentNAV is intentionally NOT deployed here — it is a
// per-basket contract (constructor takes a specific recipe), instantiated per fund, not infra.
import { ensure, getDeployer, loadConfig, saveConfig, DEFAULTS, EXPLORER } from "./_shared";

export async function deployL2() {
  console.log("== L2: oracle infra + OracleRouter + NAVEngine ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();

  // Persist the params actually used (transparency + reproducibility).
  const p = { ...DEFAULTS, ...(config.params ?? {}) };
  config.params = p;
  saveConfig(config);

  // Mock oracle infra (testnet stand-ins for Chainlink Data Streams + the L2 sequencer feed).
  const verifier = await ensure(config, "MockVerifierProxy", [], deployer);
  const sequencer = await ensure(config, "MockSequencerUptimeFeed", [], deployer);

  // Production adapter over the (mock) verifier.
  const adapter = await ensure(config, "ChainlinkAdapter", [verifier, p.schemaVersion], deployer);

  // Router gates cached readings on staleness + market status + sequencer health. Owner = deployer.
  const router = await ensure(
    config,
    "OracleRouter",
    [adapter, sequencer, p.sequencerGracePeriod, p.stalenessThreshold, deployer],
    deployer,
  );

  // Read-only basket NAV over a vault's actual holdings.
  const navEngine = await ensure(config, "NAVEngine", [router], deployer);

  console.log(`\n✅ L2 ready. Router: ${EXPLORER}${router}`);
  console.log("   Next: router.setFeed(asset, feedId) per constituent, then keepers call ingest().\n");
  return { verifier, sequencer, adapter, router, navEngine };
}

if (require.main === module) {
  deployL2().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
