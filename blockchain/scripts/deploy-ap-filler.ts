// (Re)deploy the MockAPFiller and record it under deployments.MockAPFiller. Run this after the filler gains
// the registry hooks (setVaultOperator / wrapInventory), then update the backend FORWARD_AP_FILLER_ADDRESS to
// the printed address and re-run prepare-ap-filler.ts CATALOG=1 to fund the fresh filler's real ERC-20.
//
//   cd blockchain && REDEPLOY=1 npx hardhat run scripts/deploy-ap-filler.ts --network robinhoodTestnet
//
// Without REDEPLOY=1 it reuses the recorded address (no-op). The constructor stable is the USDG cash leg.
import { loadConfig, requireAddress, getDeployer, ensure } from "./deploy/_shared";

async function main() {
  const { address: me } = await getDeployer();
  const config = loadConfig();
  const usdg = requireAddress(config, "USDG", "deploy-l1.ts");
  const addr = await ensure(config, "MockAPFiller", [usdg], me);
  console.log(`\n✅ MockAPFiller at ${addr}. Set backend FORWARD_AP_FILLER_ADDRESS=${addr} and re-fund it (prepare-ap-filler.ts CATALOG=1).`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
