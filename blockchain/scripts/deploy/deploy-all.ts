// Orchestrator — deploys the full Meridian stack in dependency order: L1 -> L2 -> L4 -> L3.
//
//   npx hardhat run scripts/deploy/deploy-all.ts --network robinhoodTestnet
//
// Each layer persists its addresses into config/testnet.json as it goes, and reuses anything already
// recorded (idempotent). Re-run safely after a faucet top-up or a partial failure; set REDEPLOY=1 to
// force fresh deploys of everything. L3 (rebalance/keeper) runs last: it needs the CloneFactory (L1)
// and reads the existing PriceAggregator (L4).
import { deployL1 } from "./deploy-l1";
import { deployL2 } from "./deploy-l2";
import { deployL3 } from "./deploy-l3";
import { deployL4 } from "./deploy-l4";
import { loadConfig } from "./_shared";

async function main() {
  await deployL1();
  await deployL2();
  await deployL4();
  await deployL3();

  console.log("== Full stack deployed ==");
  const d = loadConfig().deployments ?? {};
  for (const [name, info] of Object.entries(d)) {
    console.log(`  ${name.padEnd(20)} ${info.address}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
