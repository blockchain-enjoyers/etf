import type {
  MarketStatus as WireMarketStatus,
  OracleSource as WireOracleSource,
  OracleSeverity as WireOracleSeverity,
  VaultType as WireVaultType,
} from "@meridian/sdk";

/**
 * Canonical PascalCase enums (Prisma / domain, mirroring the Solidity MeridianTypes)
 * mapped to the @meridian/sdk wire forms. Explicit tables — NOT char-lowercasing —
 * because the wire forms are inconsistent (e.g. `RedStone` -> `redstone`, not `redStone`).
 * Single source of truth for the PascalCase->wire mapping; reused by NavStreamService + API controllers.
 */
const MARKET_STATUS_WIRE: Record<string, WireMarketStatus> = {
  Unknown: "unknown",
  PreMarket: "preMarket",
  Regular: "regular",
  PostMarket: "postMarket",
  Overnight: "overnight",
  Closed: "closed",
};

const ORACLE_SOURCE_WIRE: Record<string, WireOracleSource> = {
  Chainlink: "chainlink",
  Pyth: "pyth",
  RedStone: "redstone",
  DexTwap: "dexTwap",
  PerpMark: "perpMark",
  LastClose: "lastClose",
};

export function marketStatusToWire(s: string): WireMarketStatus {
  const w = MARKET_STATUS_WIRE[s];
  if (!w) throw new Error(`unknown MarketStatus: ${s}`);
  return w;
}

export function oracleSourceToWire(s: string): WireOracleSource {
  const w = ORACLE_SOURCE_WIRE[s];
  if (!w) throw new Error(`unknown OracleSource: ${s}`);
  return w;
}

const SEVERITY_WIRE: Record<string, WireOracleSeverity> = {
  Open: "open", Degraded: "degraded", Halted: "halted", Closed: "closed", Unknown: "unknown",
};
const SEVERITY_VENUE: Record<string, WireMarketStatus> = {
  Open: "regular", Degraded: "regular", Halted: "closed", Closed: "closed", Unknown: "unknown",
};
const VAULT_TYPE_WIRE: Record<string, WireVaultType> = {
  Basket: "basket", Managed: "managed", Committed: "committed", Rebalance: "rebalance",
  Registry: "registry",
};

export function severityToWire(s: string): WireOracleSeverity {
  const w = SEVERITY_WIRE[s]; if (!w) throw new Error(`unknown OracleSeverity: ${s}`); return w;
}
export function severityToVenue(s: string): WireMarketStatus {
  const v = SEVERITY_VENUE[s]; if (!v) throw new Error(`unknown OracleSeverity: ${s}`); return v;
}
export function vaultTypeToWire(s: string): WireVaultType {
  const w = VAULT_TYPE_WIRE[s]; if (!w) throw new Error(`unknown VaultType: ${s}`); return w;
}
