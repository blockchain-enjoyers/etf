// L3 — keeper-incentive + rebalance engine. Run AFTER `REDEPLOY=1 npm run deploy:l1` (fresh factory).
//   npx hardhat run scripts/deploy/deploy-l3.ts --network robinhoodTestnet
//
// Deploys the 5 new L3 contracts and wires them: registers the auction as a KeeperModule executor,
// sets the per-call reward ceiling, points the (fresh) CloneFactory at the rebalance impl, and
// whitelists any configured constituents. Reuses L2/L4 (the observer reads the existing
// PriceAggregator). Idempotent via ensure() + read-before-write wiring guards.
//
// Governance params via config.params.l3 (or the defaults below). execMode stays MANAGER_ONLY
// (secure default) — set per-fund at runtime, never PERMISSIONLESS with a funded escrow (spec §9).
import { ethers } from "hardhat";
import { ensure, getDeployer, loadConfig, requireAddress, EXPLORER } from "./_shared";

const L3_DEFAULTS = {
  keeperOwner: "", // "" => deployer; set to the governance multisig
  maxTip: (5n * 10n ** 15n).toString(), // 0.005 share — per-bid tip ceiling
  maxRewardPerCall: (10n ** 18n).toString(), // 1 share — hard per-call reward ceiling
  trigger: 500,
  reset: 200,
  cooldown: 86_400,
  minCardinality: 2,
  constituents: [] as string[], // token addresses to whitelist (append-only)
};

export async function deployL3() {
  console.log("== L3: KeeperModule + ManagedRebalanceVault + Observer + Module + Auction ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();
  const p = { ...L3_DEFAULTS, ...((config.params as any)?.l3 ?? {}) };
  const gov = p.keeperOwner || deployer;

  const factory = requireAddress(config, "CloneFactory", "REDEPLOY=1 deploy-l1.ts");
  const aggregator = requireAddress(config, "PriceAggregator", "deploy-l4.ts");

  // --- deploy ---
  const keeperModule = await ensure(config, "KeeperModule", [gov], deployer);
  const rebalanceImpl = await ensure(config, "ManagedRebalanceVault", [], deployer);
  const observer = await ensure(config, "RebalanceObserver", [aggregator], deployer);
  const module = await ensure(
    config,
    "RebalanceModule",
    [gov, p.trigger, p.reset, p.cooldown, p.minCardinality],
    deployer,
  );
  const auction = await ensure(config, "RebalanceAuction", [keeperModule, p.maxTip], deployer);

  // --- wire (owner == deployer here; if gov is a multisig, emit these as a tx batch instead) ---
  const f = await ethers.getContractAt("CloneFactory", factory);
  if ((await f.rebalanceImpl()) !== rebalanceImpl) {
    console.log("  wiring: factory.setRebalanceImpl");
    await (await f.setRebalanceImpl(rebalanceImpl)).wait();
  }

  const registryImpl = await ensure(config, "RegistryRebalanceVault", [], deployer);
  if ((await f.registryRebalanceImpl()) !== registryImpl) {
    console.log("  wiring: factory.setRegistryRebalanceImpl");
    await (await f.setRegistryRebalanceImpl(registryImpl)).wait();
  }

  const km = await ethers.getContractAt("KeeperModule", keeperModule);
  if (!(await km.isExecutor(auction))) {
    console.log("  wiring: keeperModule.setExecutor(auction, true)");
    await (await km.setExecutor(auction, true)).wait();
  }
  if ((await km.maxRewardPerCall()).toString() !== p.maxRewardPerCall) {
    console.log("  wiring: keeperModule.setMaxRewardPerCall");
    await (await km.setMaxRewardPerCall(p.maxRewardPerCall)).wait();
  }

  for (const t of p.constituents) {
    if (!(await f.constituentAllowed(t))) {
      console.log(`  wiring: factory.setConstituentAllowed(${t})`);
      await (await f.setConstituentAllowed(t, true)).wait();
    }
  }

  console.log(`\n✅ L3 ready.`);
  console.log(`   KeeperModule:      ${EXPLORER}${keeperModule}`);
  console.log(`   RebalanceImpl:     ${EXPLORER}${rebalanceImpl}`);
  console.log(`   RegistryImpl:      ${EXPLORER}${registryImpl}`);
  console.log(`   Auction:           ${EXPLORER}${auction}`);
  console.log(`   Observer/Module:   ${observer} / ${module}`);
  console.log(`   Next: factory.setMeridian/Treasury(gov); per-fund createRebalanceBasket/createRegistryIndex + setExecutor.`);
  return { keeperModule, rebalanceImpl, registryImpl, observer, module, auction };
}

if (require.main === module) {
  deployL3().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
