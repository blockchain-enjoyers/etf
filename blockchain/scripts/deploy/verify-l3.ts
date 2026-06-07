// L3 post-deploy read-backs (spec §10). Reads the recorded addresses and asserts the wiring landed.
//   npx hardhat run scripts/deploy/verify-l3.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "./_shared";

async function main() {
  const c = loadConfig();
  const factory = requireAddress(c, "CloneFactory", "deploy-l1.ts");
  const aggregator = requireAddress(c, "PriceAggregator", "deploy-l4.ts");
  const rebalanceImpl = requireAddress(c, "ManagedRebalanceVault", "deploy-l3.ts");
  const keeperModule = requireAddress(c, "KeeperModule", "deploy-l3.ts");
  const auction = requireAddress(c, "RebalanceAuction", "deploy-l3.ts");
  const module = requireAddress(c, "RebalanceModule", "deploy-l3.ts");
  const observer = requireAddress(c, "RebalanceObserver", "deploy-l3.ts");
  const p = { maxTip: "5000000000000000", maxRewardPerCall: "1000000000000000000", trigger: 500n, reset: 200n, ...((c.params as any)?.l3 ?? {}) };

  const f = await ethers.getContractAt("CloneFactory", factory);
  const km = await ethers.getContractAt("KeeperModule", keeperModule);
  const au = await ethers.getContractAt("RebalanceAuction", auction);
  const mo = await ethers.getContractAt("RebalanceModule", module);
  const ob = await ethers.getContractAt("RebalanceObserver", observer);

  const eq = (a: any, b: any) => String(a).toLowerCase() === String(b).toLowerCase();
  const checks: [string, boolean, string][] = [
    ["factory.rebalanceImpl == ManagedRebalanceVault", eq(await f.rebalanceImpl(), rebalanceImpl), rebalanceImpl],
    ["keeperModule.isExecutor(auction)", await km.isExecutor(auction), "true"],
    ["keeperModule.maxRewardPerCall == cap", eq(await km.maxRewardPerCall(), p.maxRewardPerCall), String(p.maxRewardPerCall)],
    ["auction.keeperModule == KeeperModule", eq(await au.keeperModule(), keeperModule), keeperModule],
    ["auction.maxTip == maxTip", eq(await au.maxTip(), p.maxTip), String(p.maxTip)],
    ["module.triggerBandBps == trigger", eq(await mo.triggerBandBps(), p.trigger), String(p.trigger)],
    ["module.resetBandBps == reset", eq(await mo.resetBandBps(), p.reset), String(p.reset)],
    ["module.trigger > reset", (await mo.triggerBandBps()) > (await mo.resetBandBps()), "invariant"],
    ["observer.aggregator == PriceAggregator", eq(await ob.aggregator(), aggregator), aggregator],
  ];

  let ok = true;
  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? "✅" : "❌"} ${name}  (${detail})`);
    if (!pass) ok = false;
  }
  if (!ok) throw new Error("L3 verification FAILED — see ❌ above");
  console.log("\n✅ L3 wiring verified.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
