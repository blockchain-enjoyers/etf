// Surgical oracle redeploy to enable settlement-grade Open NAV.
//
//   cd blockchain && npx hardhat run scripts/redeploy-open-nav.ts --network robinhoodTestnet
//
// PROBLEM: the demo shared MockSource was registered at index 0 of PriceAggregator (deploy-demo-stocks),
// so configure-l4 only added the weekend source at index 1 — the real weekday UniversalSignedSource was
// never registered. The aggregator has NO removeSource, so the weekday slot can't be fixed in place;
// the result is a permanent Closed/estimated NAV (weekday leg dead) and forward settle reverts on the
// g2/g3 (NotOpen/NotSafe) gates.
//
// FIX: deploy a CLEAN PriceAggregator with ONLY [weekday@0, weekend@1] per token (the layout the backend
// payload builder + configure-l4's sourceCount==0 branch assume), then cascade the immutable-linked
// FairValueNAV → BasketNavObserver → ForwardCashQueue. Everything else is REUSED: the registry vault,
// CloneFactory, USDG, the two UniversalSignedSource instances (committees already set), router/peg,
// keeperModule. The registry vault is NOT redeployed (it never references the oracle).
import { ethers } from "hardhat";
import { loadConfig, saveConfig, requireAddress, getDeployer, EXPLORER } from "./deploy/_shared";

async function main() {
  const { address: deployer } = await getDeployer();
  const c = loadConfig();
  const D = c.deployments!;
  const tokens: string[] = (c.params as any)?.demo?.stocks;
  if (!tokens?.length) throw new Error("params.demo.stocks missing — run deploy-demo-stocks first");

  const weekday = requireAddress(c, "UniversalSignedSource", "deploy-l4.ts");
  const weekend = requireAddress(c, "UniversalSignedSourceWeekend", "deploy-l4.ts");
  const usdg = requireAddress(c, "USDG", "deploy-l1.ts");
  const keeperModule = requireAddress(c, "KeeperModule", "deploy-l3.ts");
  const vaultAddr = requireAddress(c, "RegistryIndex", "deploy-l5.ts");
  const router = requireAddress(c, "MockFeedRouter", "deploy-l5.ts");
  const peg = requireAddress(c, "MockPegFeed", "deploy-l5.ts");

  console.log("OLD oracle:", {
    PriceAggregator: D["PriceAggregator"]?.address,
    FairValueNAV: D["FairValueNAV"]?.address,
    BasketNavObserver: D["BasketNavObserver"]?.address,
    ForwardCashQueue: D["ForwardCashQueue"]?.address,
  });

  // 1. Fresh PriceAggregator (no MockSource).
  const agg = await (await ethers.getContractFactory("PriceAggregator")).deploy(deployer);
  await agg.waitForDeployment();
  const aggAddr = await agg.getAddress();
  console.log(`  PriceAggregator      ${aggAddr}`);

  // 2. Register [weekday@0, weekend@1] per token (ORDER MATTERS: backend payload index convention),
  //    then relax safety params for the 2-synthetic-source testnet (mirror configure-l4).
  for (const t of tokens) {
    await (await agg.addSource(t, weekday)).wait();
    await (await agg.addSource(t, weekend)).wait();
    console.log(`    sources ${t} -> [weekday@0, weekend@1]`);
  }
  const [maxW, div, stale, dMin] = await Promise.all([
    agg.maxWeightBps(),
    agg.divergenceBps(),
    agg.staleHorizon(),
    agg.dMin(),
  ]);
  await (await agg.setParams(maxW, div, stale, dMin, 0, 0, 0, 10000, 1)).wait();
  console.log("    params relaxed: wDisp/wDepth/wStale=0, maxSafeBandBps=10000, minSafeSources=1");

  // 3. Fresh FairValueNAV over the clean aggregator (aggregator is immutable on the NAV reader).
  const nav = await (await ethers.getContractFactory("FairValueNAV")).deploy(aggAddr);
  await nav.waitForDeployment();
  const navAddr = await nav.getAddress();
  console.log(`  FairValueNAV         ${navAddr}`);

  // 4. Fresh observer over the new NAV (nav is immutable on the observer).
  const obs = await (await ethers.getContractFactory("BasketNavObserver")).deploy(navAddr);
  await obs.waitForDeployment();
  const obsAddr = await obs.getAddress();
  console.log(`  BasketNavObserver    ${obsAddr}`);

  // 5. Fresh ForwardCashQueue (navEngine immutable). Args: vault, stable, navEngine, observer,
  //    keeperModule, router, pegFeed, owner. Then re-wire gate + roles.
  const q = await (await ethers.getContractFactory("ForwardCashQueue")).deploy(
    vaultAddr, usdg, navAddr, obsAddr, keeperModule, router, peg, deployer,
  );
  await q.waitForDeployment();
  const queueAddr = await q.getAddress();
  console.log(`  ForwardCashQueue     ${queueAddr}`);
  await (await q.setGateParams(2, 600, 200, 200, 3600)).wait();
  // g1 ref = the weekday source (registered on the new aggregator); the MockSource is NOT registered now.
  await (await q.setG1Refs(aggAddr, weekday)).wait();
  await (await q.setKeeperTip(0)).wait();
  const km = await ethers.getContractAt("KeeperModule", keeperModule);
  if (!(await km.isExecutor(queueAddr))) await (await km.setExecutor(queueAddr, true)).wait();
  const vault = await ethers.getContractAt("RegistryRebalanceVault", vaultAddr);
  if (!(await vault.isSettler(queueAddr))) await (await vault.setSettler(queueAddr, true)).wait();

  // 6. Persist (only the 4 oracle contracts change; everything else keeps its address).
  D["PriceAggregator"] = { address: aggAddr };
  D["FairValueNAV"] = { address: navAddr };
  D["BasketNavObserver"] = { address: obsAddr };
  D["ForwardCashQueue"] = { address: queueAddr };
  saveConfig(c);

  console.log(`\n✅ Clean oracle live. Aggregator: ${EXPLORER}${aggAddr}`);
  console.log(`   ForwardCashQueue ${queueAddr}  (registry vault ${vaultAddr} unchanged)`);
  console.log("\nNext: yarn abi:sync && yarn workspace @meridian/contracts build");
  console.log(`      backend/.env FORWARD_QUEUES => {"${vaultAddr}":"${queueAddr}"}`);
  console.log("      rebuild + restart backend; set MARKET_FORCE_OPEN=true to verify Open now.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
