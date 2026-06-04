// Mirrors MeridianTypes.MarketStatus / OracleSource (contracts/src/types/MeridianTypes.sol).
export type MarketStatus =
  | "unknown"
  | "preMarket"
  | "regular"
  | "postMarket"
  | "overnight"
  | "closed";

export type OracleSource =
  | "chainlink"
  | "pyth"
  | "redstone"
  | "dexTwap"
  | "perpMark"
  | "lastClose";
