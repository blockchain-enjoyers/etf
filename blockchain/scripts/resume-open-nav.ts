// Resume the redeploy-open-nav cascade after the queue-wiring step hit a nonce race (the running
// backend keeper shares the deployer key). The 4 oracle contracts were already deployed on-chain but
// not recorded; this records them and completes the ForwardCashQueue wiring. Idempotent.
//   cd blockchain && npx hardhat run scripts/resume-open-nav.ts --network robinhoodTestnet
import { ethers } from "hardhat";
import { loadConfig, saveConfig, requireAddress, getDeployer, EXPLORER } from "./deploy/_shared";

const NEW = {
  PriceAggregator: "0x25f04d55C0b3608C258c21CB603aCEe197Ca5301",
  FairValueNAV: "0xcfaA21689D7273fADBD7576eDA0991576900aD96",
  BasketNavObserver: "0x16221e4FA1842B36587B496f81Ad3B51cc78E0B7",
  ForwardCashQueue: "0xf109Cf55511d15E7906FbE421a39dB9f42121994",
};

async function main() {
  await getDeployer();
  const c = loadConfig();
  const D = c.deployments!;
  const weekday = requireAddress(c, "UniversalSignedSource", "deploy-l4.ts");
  const keeperModule = requireAddress(c, "KeeperModule", "deploy-l3.ts");
  const vaultAddr = requireAddress(c, "RegistryIndex", "deploy-l5.ts");

  D["PriceAggregator"] = { address: NEW.PriceAggregator };
  D["FairValueNAV"] = { address: NEW.FairValueNAV };
  D["BasketNavObserver"] = { address: NEW.BasketNavObserver };
  D["ForwardCashQueue"] = { address: NEW.ForwardCashQueue };
  saveConfig(c);
  console.log("recorded new oracle addresses in testnet.json");

  const q = await ethers.getContractAt("ForwardCashQueue", NEW.ForwardCashQueue);
  console.log("  queue.vault     ", await q.vault());
  console.log("  queue.navEngine ", await q.navEngine());
  console.log("  queue.observer  ", await q.observer());

  await (await q.setGateParams(2, 600, 200, 200, 3600)).wait();
  console.log("  setGateParams ok");
  await (await q.setG1Refs(NEW.PriceAggregator, weekday)).wait();
  console.log("  setG1Refs ok (g1 ref = weekday source)");
  await (await q.setKeeperTip(0)).wait();
  console.log("  setKeeperTip ok");

  const km = await ethers.getContractAt("KeeperModule", keeperModule);
  if (!(await km.isExecutor(NEW.ForwardCashQueue))) {
    await (await km.setExecutor(NEW.ForwardCashQueue, true)).wait();
    console.log("  setExecutor ok");
  } else console.log("  executor already set");

  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);
  if (!(await vault.isSettler(NEW.ForwardCashQueue))) {
    await (await vault.setSettler(NEW.ForwardCashQueue, true)).wait();
    console.log("  setSettler ok");
  } else console.log("  settler already set");

  console.log(`\n✅ wiring complete. Queue ${EXPLORER}${NEW.ForwardCashQueue} (vault ${vaultAddr})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
