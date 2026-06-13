import { ethers } from "hardhat";
import { loadConfig, requireAddress } from "./_shared";

export async function verifyL5() {
  const config = loadConfig();
  const vaultAddr = requireAddress(config, "RegistryIndex", "deploy-l5.ts");
  const queueAddr = requireAddress(config, "ForwardCashQueue", "deploy-l5.ts");
  const usdg = requireAddress(config, "USDG", "deploy-l1.ts");
  const km = requireAddress(config, "KeeperModule", "deploy-l3.ts");
  const router = requireAddress(config, "MockFeedRouter", "deploy-l5.ts");
  const expected = (config.params as any)?.l5?.constituents ?? [];

  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);
  const q = await ethers.getContractAt("ForwardCashQueue", queueAddr);
  const keeper = await ethers.getContractAt("KeeperModule", km);
  const r = await ethers.getContractAt("MockFeedRouter", router);

  const checks: [string, boolean][] = [];
  checks.push(["vault bootstrapped (supply>0)", (await vault.totalSupply()) > 0n]);
  checks.push(["recipeRoot set", (await vault.recipeRoot()) !== ethers.ZeroHash]);
  const held = await vault.heldTokens();
  checks.push([`held == constituents (${held.length}/${expected.length})`, held.length > 0 && held.length === expected.length]);
  checks.push(["queue.isRegistry", (await q.isRegistry()) === true]);
  checks.push(["queue.vault == vaultAddr", (await q.vault()).toLowerCase() === vaultAddr.toLowerCase()]);
  checks.push(["queue.stable == USDG", (await q.stable()).toLowerCase() === usdg.toLowerCase()]);
  checks.push(["vault.isSettler(queue)", (await vault.isSettler(queueAddr)) === true]);
  checks.push(["keeperModule.isExecutor(queue)", (await keeper.isExecutor(queueAddr)) === true]);
  for (const t of held) checks.push([`router feed set ${t}`, (await r.feedIdOf(t)) !== ethers.ZeroHash]);

  let ok = true;
  for (const [name, pass] of checks) { console.log(`  ${pass ? "OK " : "XX "} ${name}`); ok &&= pass; }
  if (!ok) throw new Error("verify-l5: one or more checks failed");
  console.log("\nL5 verified.");
}

if (require.main === module) {
  verifyL5().catch((e) => { console.error(e); process.exitCode = 1; });
}
