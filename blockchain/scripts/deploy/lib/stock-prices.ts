import { readFileSync } from "node:fs";
import { join } from "node:path";

// Real per-share USD prices for the Robinhood tickers, from the Dune export
// tools/registry/input/stocksTable.json (columnar: data.stocks = { columns, types, rows }).
// This is the HONEST price origin for the demo keeper — NOT market_cap/total_supply (that divides by the
// tiny tokenized on-chain supply and yields nonsense like NVDA=$1.7B).
export function loadStockPrices(): Record<string, number> {
  const p = join(__dirname, "..", "..", "..", "..", "tools", "registry", "input", "stocksTable.json");
  const tbl = JSON.parse(readFileSync(p, "utf8")).data.stocks as { columns: string[]; rows: any[][] };
  const ti = tbl.columns.indexOf("ticker");
  const pi = tbl.columns.indexOf("usd_stock_price");
  const out: Record<string, number> = {};
  for (const r of tbl.rows) {
    const price = Number(r[pi]);
    if (r[ti] && price > 0) out[r[ti]] = price;
  }
  return out;
}
