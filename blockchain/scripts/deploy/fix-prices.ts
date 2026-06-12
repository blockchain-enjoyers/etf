// Backfill real per-share USD prices into config.params.demo.stocks[ticker].priceUsd.
// The 100 stocks were deployed before the price source was fixed, so their stored priceUsd is the bogus
// synthetic value. This overwrites them with the real stocksTable.json price. Offline (config write only).
import { loadConfig, saveConfig } from "./_shared";
import { loadStockPrices } from "./lib/stock-prices";

function main() {
  const config = loadConfig();
  const prices = loadStockPrices();
  const stocks = (config.params as any)?.demo?.stocks ?? {};
  let fixed = 0;
  const missing: string[] = [];
  for (const ticker of Object.keys(stocks)) {
    const p = prices[ticker];
    if (p > 0) { stocks[ticker].priceUsd = p; fixed++; }
    else missing.push(ticker);
  }
  saveConfig(config);
  console.log(`Backfilled real priceUsd for ${fixed}/${Object.keys(stocks).length} stocks.`);
  if (missing.length) console.log(`  missing price (left as-is): ${missing.join(",")}`);
}

main();
