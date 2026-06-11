import { ethers } from "hardhat";
import { ensure, getDeployer, loadConfig, saveConfig, requireAddress, EXPLORER } from "./_shared";

const DEMO = { names: ["MSTRx", "TSLAx", "NVDAx"] };

export async function deployDemoStocks() {
  console.log("== DEMO: constituents + whitelist + shared price source ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();
  const factory = requireAddress(config, "CloneFactory", "deploy-l1.ts");
  const aggregator = requireAddress(config, "PriceAggregator", "deploy-l4.ts");
  const f = await ethers.getContractAt("CloneFactory", factory);
  const agg = await ethers.getContractAt("PriceAggregator", aggregator);

  // User-provided addresses win; else deploy 18-dec mock constituents.
  const provided = (config.params as any)?.demo?.stocks as string[] | undefined;
  const stocks: string[] = [];
  for (let i = 0; i < DEMO.names.length; i++) {
    const name = DEMO.names[i];
    const addr = provided?.[i]
      ? provided[i]
      : await ensure(config, "MockERC20Decimals", [name, name, 18], deployer, `Stock_${name}`);
    stocks.push(addr);
  }

  // Whitelist each constituent.
  for (const t of stocks) {
    if (!(await f.constituentAllowed(t))) {
      console.log(`  wiring: factory.setConstituentAllowed(${t})`);
      await (await f.setConstituentAllowed(t, true)).wait();
    }
  }

  // ONE shared settable MockSource, registered in the real aggregator for EVERY token (g1 passes with one ref).
  const shared = await ensure(config, "MockSource", [], deployer, "Source_Shared");
  const sources: Record<string, string> = {};
  for (const t of stocks) {
    sources[t] = shared;
    if (!(await agg.isSource(t, shared))) {
      console.log(`  wiring: aggregator.addSource(${t}, shared)`);
      await (await agg.addSource(t, shared)).wait();
    }
  }

  (config.params as any) ??= {};
  (config.params as any).demo = { ...((config.params as any).demo ?? {}), stocks, sources, sharedSource: shared, names: DEMO.names };
  saveConfig(config);
  console.log(`\n✅ Demo constituents ready: ${stocks.map((s, i) => `${DEMO.names[i]}=${s}`).join(", ")}`);
  console.log(`   Shared source: ${EXPLORER}${shared}`);
  return { stocks, sources, sharedSource: shared };
}

if (require.main === module) {
  deployDemoStocks().catch((e) => { console.error(e); process.exitCode = 1; });
}
