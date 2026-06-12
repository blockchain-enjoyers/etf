// T0 preflight: verify deployer is owner/admin on the colleague's chain-46630 stand and discover the
// AccessControlsRegistry (not recorded in the colleague's testnet.json). Read-only except it writes the
// discovered AccessControlsRegistry address back into config so later steps (grantRole) can use it.
import { ethers } from "hardhat";
import { getDeployer, loadConfig, saveConfig, requireAddress } from "./_shared";

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash; // bytes32(0)

async function main() {
  const { address: me } = await getDeployer();
  const config = loadConfig();

  const aggAddr = requireAddress(config, "PriceAggregator", "colleague testnet.json");
  const facAddr = requireAddress(config, "CloneFactory", "colleague testnet.json");
  const agg = await ethers.getContractAt("PriceAggregator", aggAddr);
  const fac = await ethers.getContractAt("CloneFactory", facAddr);

  const aggOwner = await agg.owner();
  const facOwner = await fac.owner();
  console.log(`PriceAggregator.owner: ${aggOwner}  ${aggOwner.toLowerCase() === me.toLowerCase() ? "== me OK" : "!= me  <-- PROBLEM"}`);
  console.log(`CloneFactory.owner:    ${facOwner}  ${facOwner.toLowerCase() === me.toLowerCase() ? "== me OK" : "!= me  <-- PROBLEM"}`);

  // Discover the AccessControlsRegistry from a Stock (ACCESS_CONTROLLED_REGISTRY is public immutable).
  const stock = await ethers.getContractAt("Stock", requireAddress(config, "Stock_MSTRx", "colleague testnet.json"));
  const reg = await stock.ACCESS_CONTROLLED_REGISTRY();
  console.log(`AccessControlsRegistry (from Stock_MSTRx): ${reg}`);

  const registry = await ethers.getContractAt("AccessControlsRegistry", reg);
  const isAdmin = await registry.hasRole(DEFAULT_ADMIN_ROLE, me);
  console.log(`registry.hasRole(DEFAULT_ADMIN_ROLE, me): ${isAdmin ? "true OK (grantRole will work)" : "false  <-- PROBLEM (cannot grant MINTER_ROLE)"}`);

  // Confirm the two signed-source instances + weekendAware flags.
  const weekday = await ethers.getContractAt("UniversalSignedSource", requireAddress(config, "UniversalSignedSource", "colleague"));
  const weekend = await ethers.getContractAt("UniversalSignedSource", requireAddress(config, "UniversalSignedSourceWeekend", "colleague"));
  console.log(`UniversalSignedSource.weekendAware:        ${await weekday.weekendAware()} (expect false)`);
  console.log(`UniversalSignedSourceWeekend.weekendAware: ${await weekend.weekendAware()} (expect true)`);
  console.log(`weekday.threshold=${await weekday.threshold()}  weekend.threshold=${await weekend.threshold()}`);

  // Record the discovered registry so deploy-faucet can requireAddress it.
  config.deployments ??= {};
  config.deployments["AccessControlsRegistry"] = { address: reg };
  saveConfig(config);
  console.log(`\nRecorded AccessControlsRegistry into config. Preflight done.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
