import { ethers } from "hardhat";
import { getDeployer, loadConfig, saveConfig, requireAddress, ensure } from "./_shared";
import { selectTopN, loadRegistry } from "./lib/registry-select";
import { loadStockPrices } from "./lib/stock-prices";
import { deployStockImpl, deployStockCloneFactory, deployStockClone } from "./lib/deploy-stock";

const TARGET_N = Number(process.env.TARGET_N ?? 100);
const PROBE_BATCH = Number(process.env.PROBE_BATCH ?? 10);
const MARGIN = 0.8;

export async function deployDemoStocks() {
  console.log("== DEMO: Stock scale-out under registry top-N ==");
  const { address: deployer } = await getDeployer();
  const config = loadConfig();
  const factory = requireAddress(config, "CloneFactory", "colleague testnet.json");
  // No AccessControlsRegistry exists in the colleague's deployment (their 3 demo stocks are public-mint
  // MockERC20Decimals). Deploy our own so the role-gated Stock (mint = MINTER_ROLE; open faucetMint) model holds.
  const registry = await ensure(config, "AccessControlsRegistry", [deployer], deployer, "AccessControlsRegistry");
  const f = await ethers.getContractAt("CloneFactory", factory);
  const provider = ethers.provider;

  // Shared Stock impl (once). Reuse if already recorded.
  let impl = config.deployments?.["Stock_impl"]?.address;
  if (!impl) {
    impl = await deployStockImpl(registry);
    config.deployments ??= {};
    config.deployments["Stock_impl"] = { address: impl };
    saveConfig(config);
    console.log(`  Stock_impl ${impl}`);
  }

  // Shared StockCloneFactory (once). Reuse if already recorded.
  let stockFactory = config.deployments?.["StockCloneFactory"]?.address;
  if (!stockFactory) {
    stockFactory = await deployStockCloneFactory();
    config.deployments ??= {};
    config.deployments["StockCloneFactory"] = { address: stockFactory };
    saveConfig(config);
    console.log(`  StockCloneFactory ${stockFactory}`);
  }

  const picks = selectTopN(loadRegistry(), TARGET_N);
  // Override the (placeholder) selection price with the real per-share USD price for the keeper.
  const realPrices = loadStockPrices();
  for (const p of picks) { if (realPrices[p.ticker] > 0) p.priceUsd = realPrices[p.ticker]; }
  if (picks.length < PROBE_BATCH) {
    console.log(`  WARN: registry returned only ${picks.length} tickers (< PROBE_BATCH=${PROBE_BATCH})`);
  }
  (config.params as any) ??= {};
  const demo = ((config.params as any).demo ??= {});
  // The colleague's config carries demo.stocks as a legacy ARRAY (their 3 public-mint MockERC20 scene
  // stocks). Our scale-out uses demo.stocks as an OBJECT map keyed by ticker. Migrate the legacy array
  // into demo.scene once so JSON.stringify doesn't silently drop ticker-keyed entries off an array.
  if (Array.isArray(demo.stocks)) {
    demo.scene ??= { stocks: demo.stocks, sources: demo.sources, sharedSource: demo.sharedSource, names: demo.names };
    demo.stocks = {};
  }
  const stocks: Record<string, { address: string; priceUsd: number }> = demo.stocks ?? {};
  demo.stocks = stocks;

  // Deploy a proxy AND whitelist it, recording + flushing so a partial run resumes. Skips a ticker
  // already recorded. Returns true if it actually deployed (so the probe can measure cost).
  async function ensureStock(p: { ticker: string; symbol: string; priceUsd: number }): Promise<boolean> {
    if (stocks[p.ticker]) return false; // already deployed in a prior (partial) run
    const address = await deployStockClone(stockFactory, impl, p.ticker, p.symbol);
    if (!(await f.constituentAllowed(address))) {
      await (await f.setConstituentAllowed(address, true)).wait();
    }
    stocks[p.ticker] = { address, priceUsd: p.priceUsd };
    demo.count = Object.keys(stocks).length;
    saveConfig(config); // incremental flush: partial run is resumable
    return true;
  }

  // 1. Probe: deploy+whitelist PROBE_BATCH, measure cost per stock (includes the whitelist tx).
  const before = await provider.getBalance(deployer);
  let probedCount = 0;
  for (const p of picks.slice(0, PROBE_BATCH)) { if (await ensureStock(p)) probedCount++; }
  const after = await provider.getBalance(deployer);
  const costPerStock = probedCount > 0 ? (before - after) / BigInt(probedCount) : 0n;
  const maxMore = costPerStock === 0n ? TARGET_N : Number((after * BigInt(Math.floor(MARGIN * 100)) / 100n) / costPerStock);
  const finalN = Math.min(TARGET_N, PROBE_BATCH + maxMore, picks.length);
  console.log(`  costPerStock~=${ethers.formatEther(costPerStock)} ETH (incl. whitelist); budget allows ~${maxMore} more; finalN=${finalN}`);

  // 2. Deploy+whitelist the rest up to finalN.
  for (const p of picks.slice(PROBE_BATCH, finalN)) { await ensureStock(p); }

  saveConfig(config);
  console.log(`\nOK: ${Object.keys(stocks).length} demo stocks deployed + whitelisted.`);
  return stocks;
}

if (require.main === module) {
  deployDemoStocks().catch((e) => { console.error(e); process.exitCode = 1; });
}
