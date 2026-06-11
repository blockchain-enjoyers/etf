import type {
  FeedResponse,
  BasketSummary,
  BasketDetail,
  NavResponse,
  MarketPrice,
  PremiumDiscount,
  HistoryPoint,
  RedeemQuoteResponse,
} from "@meridian/sdk";

export const VAULT_OPEN  = "0xAAAA000000000000000000000000000000000001";
export const VAULT_CLOSED = "0xBBBB000000000000000000000000000000000002";
export const VAULT_HALTED = "0xCCCC000000000000000000000000000000000003";
export const VAULT_RECON  = "0xDDDD000000000000000000000000000000000004";

const NOW = 1_749_124_800_000; // 2026-06-05T12:00:00Z

// ─── Summaries ───────────────────────────────────────────────────────────────

export const fixtureSummaries: BasketSummary[] = [
  { vaultAddress: VAULT_OPEN,   name: "US Tech 10",    symbol: "UTECH10", frozen: false, weightMethod: "Static",          vaultType: "basket" },
  { vaultAddress: VAULT_CLOSED, name: "Global Macro",  symbol: "GMACRO",  frozen: false, weightMethod: "Target ±5%",      vaultType: "basket" },
  { vaultAddress: VAULT_HALTED, name: "Energy Select", symbol: "ENRGY",   frozen: false, weightMethod: "Reconstitution",   vaultType: "basket" },
  { vaultAddress: VAULT_RECON,  name: "S&P 500 Core",  symbol: "SP5C",    frozen: false, weightMethod: "Target 1/N",      vaultType: "basket" },
];

// ─── Details ─────────────────────────────────────────────────────────────────

export const fixtureDetails: Record<string, BasketDetail> = {
  [VAULT_OPEN]: {
    vaultAddress: VAULT_OPEN,
    name: "US Tech 10",
    symbol: "UTECH10",
    frozen: false,
    vaultType: "basket" as const,
    basketToken: "0xAA10000000000000000000000000000000000010",
    cashToken: "0xAA10000000000000000000000000000000000011",
    unitSize: "1000000000000000000",
    constituents: [
      { token: "0xAA01000000000000000000000000000000000001", unitQty: "500000000000000000" },
      { token: "0xAA01000000000000000000000000000000000002", unitQty: "300000000000000000" },
      { token: "0xAA01000000000000000000000000000000000003", unitQty: "200000000000000000" },
    ],
  },
  [VAULT_CLOSED]: {
    vaultAddress: VAULT_CLOSED,
    name: "Global Macro",
    symbol: "GMACRO",
    frozen: false,
    vaultType: "basket" as const,
    basketToken: "0xBB10000000000000000000000000000000000010",
    cashToken: "0xBB10000000000000000000000000000000000011",
    unitSize: "1000000000000000000",
    constituents: [
      { token: "0xBB01000000000000000000000000000000000001", unitQty: "800000000000000000" },
      { token: "0xBB01000000000000000000000000000000000002", unitQty: "200000000000000000" },
    ],
  },
  [VAULT_HALTED]: {
    vaultAddress: VAULT_HALTED,
    name: "Energy Select",
    symbol: "ENRGY",
    frozen: false,
    vaultType: "basket" as const,
    basketToken: null,
    cashToken: null,
    unitSize: "1000000000000000000",
    constituents: [
      { token: "0xCC01000000000000000000000000000000000001", unitQty: "1000000000000000000" },
    ],
  },
  [VAULT_RECON]: {
    vaultAddress: VAULT_RECON,
    name: "S&P 500 Core",
    symbol: "SP5C",
    frozen: false,
    vaultType: "basket" as const,
    basketToken: "0xDD10000000000000000000000000000000000010",
    cashToken: "0xDD10000000000000000000000000000000000011",
    unitSize: "1000000000000000000",
    constituents: [
      { token: "0xDD01000000000000000000000000000000000001", unitQty: "400000000000000000" },
      { token: "0xDD01000000000000000000000000000000000002", unitQty: "350000000000000000" },
      { token: "0xDD01000000000000000000000000000000000003", unitQty: "250000000000000000" },
    ],
  },
};

// ─── NAV responses ───────────────────────────────────────────────────────────

export const fixtureNavs: Record<string, NavResponse> = {
  [VAULT_OPEN]: {
    vaultAddress: VAULT_OPEN,
    nav: "115420000000000000000",
    confidenceLower: "115000000000000000000",
    confidenceUpper: "115840000000000000000",
    marketStatus: "regular",
    estimated: false,
    source: "chainlink",
    timestampMs: NOW - 5_000,
  },
  [VAULT_CLOSED]: {
    vaultAddress: VAULT_CLOSED,
    // estimated true: closed-market fair-value — NEVER a settlement price (iron rule)
    nav: "98760000000000000000",
    confidenceLower: "94000000000000000000",
    confidenceUpper: "103500000000000000000",
    marketStatus: "closed",
    estimated: true,
    source: "lastClose",
    timestampMs: NOW - 3_600_000,
  },
  [VAULT_HALTED]: {
    vaultAddress: VAULT_HALTED,
    nav: "72100000000000000000",
    confidenceLower: "72100000000000000000",
    confidenceUpper: "72100000000000000000",
    marketStatus: "unknown",
    estimated: false,
    source: "chainlink",
    timestampMs: NOW - 900_000,
  },
  [VAULT_RECON]: {
    vaultAddress: VAULT_RECON,
    nav: "201500000000000000000",
    confidenceLower: "201000000000000000000",
    confidenceUpper: "202000000000000000000",
    marketStatus: "regular",
    estimated: false,
    source: "chainlink",
    timestampMs: NOW - 8_000,
  },
};

// ─── Market prices ───────────────────────────────────────────────────────────

export const fixtureMarketPrices: Record<string, MarketPrice> = {
  [VAULT_OPEN]:   { vaultAddress: VAULT_OPEN,   marketPrice: "115800000000000000000", timestampMs: NOW - 3_000 },
  [VAULT_CLOSED]: { vaultAddress: VAULT_CLOSED, marketPrice: "98000000000000000000",  timestampMs: NOW - 60_000 },
  [VAULT_HALTED]: { vaultAddress: VAULT_HALTED, marketPrice: "71500000000000000000",  timestampMs: NOW - 300_000 },
  [VAULT_RECON]:  { vaultAddress: VAULT_RECON,  marketPrice: "202100000000000000000", timestampMs: NOW - 4_000 },
};

// ─── Premium / discount ──────────────────────────────────────────────────────

export const fixturePremiumDiscounts: Record<string, PremiumDiscount> = {
  [VAULT_OPEN]:   { premiumBps: 33,  nav: "115420000000000000000", marketPrice: "115800000000000000000" },
  [VAULT_CLOSED]: { premiumBps: -77, nav: "98760000000000000000",  marketPrice: "98000000000000000000" },
  [VAULT_HALTED]: { premiumBps: -83, nav: "72100000000000000000",  marketPrice: "71500000000000000000" },
  [VAULT_RECON]:  { premiumBps: 30,  nav: "201500000000000000000", marketPrice: "202100000000000000000" },
};

// ─── History ─────────────────────────────────────────────────────────────────

function makeHistory(baseNav: number, estimated: boolean): HistoryPoint[] {
  return Array.from({ length: 24 }, (_, i) => ({
    timestampMs: NOW - (23 - i) * 3_600_000,
    nav: String(BigInt(Math.round((baseNav + Math.sin(i) * 0.5) * 1e18))),
    estimated,
  }));
}

export const fixtureHistory: Record<string, HistoryPoint[]> = {
  [VAULT_OPEN]:   makeHistory(115.42, false),
  [VAULT_CLOSED]: makeHistory(98.76, true),
  [VAULT_HALTED]: makeHistory(72.1, false),
  [VAULT_RECON]:  makeHistory(201.5, false),
};

// ─── Redeem quotes ───────────────────────────────────────────────────────────

export const fixtureRedeemQuotes: Record<string, RedeemQuoteResponse> = {
  [VAULT_OPEN]: {
    assets: [
      { token: "0xAA01000000000000000000000000000000000001", amount: "500000000000000000" },
      { token: "0xAA01000000000000000000000000000000000002", amount: "300000000000000000" },
      { token: "0xAA01000000000000000000000000000000000003", amount: "200000000000000000" },
    ],
    gateState: { gated: false, reason: "none" },
  },
  [VAULT_CLOSED]: {
    assets: [
      { token: "0xBB01000000000000000000000000000000000001", amount: "800000000000000000" },
      { token: "0xBB01000000000000000000000000000000000002", amount: "200000000000000000" },
    ],
    // IRON RULE: in-kind redeem is NEVER gated by market state
    gateState: { gated: false, reason: "none" },
  },
  [VAULT_HALTED]: {
    assets: [
      { token: "0xCC01000000000000000000000000000000000001", amount: "1000000000000000000" },
    ],
    gateState: { gated: false, reason: "none" },
  },
  [VAULT_RECON]: {
    assets: [
      { token: "0xDD01000000000000000000000000000000000001", amount: "400000000000000000" },
      { token: "0xDD01000000000000000000000000000000000002", amount: "350000000000000000" },
      { token: "0xDD01000000000000000000000000000000000003", amount: "250000000000000000" },
    ],
    gateState: { gated: false, reason: "none" },
  },
};

// ─── Feed ────────────────────────────────────────────────────────────────────

export const fixtureFeed: FeedResponse = {
  items: [
    {
      vaultAddress: VAULT_OPEN,
      symbol: "UTECH10",
      nav: "115420000000000000000",
      estimated: false,
      marketStatus: "regular",
      timestampMs: NOW - 5_000,
      change24hBps: 84,
    },
    {
      vaultAddress: VAULT_CLOSED,
      symbol: "GMACRO",
      nav: "98760000000000000000",
      estimated: true,
      marketStatus: "closed",
      timestampMs: NOW - 3_600_000,
      change24hBps: -31,
    },
    {
      vaultAddress: VAULT_HALTED,
      symbol: "ENRGY",
      nav: "72100000000000000000",
      estimated: false,
      marketStatus: "unknown",
      timestampMs: NOW - 900_000,
      change24hBps: 12,
    },
    {
      vaultAddress: VAULT_RECON,
      symbol: "SP5C",
      nav: "201500000000000000000",
      estimated: false,
      marketStatus: "regular",
      timestampMs: NOW - 8_000,
      change24hBps: 47,
    },
  ],
};
