import { readFileSync } from "node:fs";
import { join } from "node:path";

export type RegistryToken = {
  ticker: string;
  underlying?: { market_cap_usd?: number | null };
  onchain?: { total_supply?: string | null };
  deployments?: { token_symbol?: string | null }[];
};

export type Selected = { ticker: string; symbol: string; priceUsd: number };

const PRICE_FLOOR = 0.01;

export function syntheticPriceUsd(t: RegistryToken): number {
  const cap = t.underlying?.market_cap_usd ?? 0;
  const supply = Number(t.onchain?.total_supply ?? 0);
  // !supply also catches NaN (from a malformed total_supply string), falling back to the floor.
  if (!cap || !supply) return PRICE_FLOOR;
  const p = cap / supply;
  return p < PRICE_FLOOR ? PRICE_FLOOR : p;
}

export function selectTopN(tokens: RegistryToken[], n: number): Selected[] {
  return tokens
    .filter((t) => (t.underlying?.market_cap_usd ?? 0) > 0)
    .sort((a, b) => (b.underlying!.market_cap_usd! - a.underlying!.market_cap_usd!))
    .slice(0, n)
    .map((t) => ({
      ticker: t.ticker,
      symbol: t.deployments?.[0]?.token_symbol ?? t.ticker,
      priceUsd: syntheticPriceUsd(t),
    }));
}

export function loadRegistry(): RegistryToken[] {
  const p = join(__dirname, "..", "..", "..", "..", "tools", "registry", "out", "registry.json");
  return JSON.parse(readFileSync(p, "utf8")).tokens as RegistryToken[];
}
