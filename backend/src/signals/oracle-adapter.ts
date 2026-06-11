import type { OracleReading, OracleSource } from "../domain/oracle.js";

// Re-export the canonical reading/source types from the adapter barrel so consumers that import the
// OracleAdapter contract (e.g. the adapters + Plan D's fusion) can take `OracleReading`/`OracleSource`
// from the same module. The single source of truth is still `../domain/oracle.ts` (no duplicate types).
export type { OracleReading, OracleSource } from "../domain/oracle.js";

/**
 * Every price source (Chainlink Data Streams, on-chain Chainlink feed, Pyth, …) implements this.
 * Adapters are deterministic + mockable; they NEVER throw for a missing/stale price — they return
 * `undefined` so the SignalRouter can fall through the ordering. Real failures (network) may reject;
 * the router wraps those in cockatiel. [spec §4, §8]
 */
export interface OracleAdapter {
  readonly source: OracleSource;
  /** Return a normalized 18-dec reading for `token`, or undefined if this source has nothing usable. */
  read(token: string): Promise<OracleReading | undefined>;
}

/** Multi-provider DI token: every adapter binds to this so the SignalRouter receives them as an array. */
export const ORACLE_ADAPTERS = Symbol("ORACLE_ADAPTERS");

/** Configured per-token feed wiring (set in BasketSource / env). */
export interface TokenFeedConfig {
  /** Our token address (basket constituent). */
  token: string;
  /** Chainlink Data Streams feed id (bytes32 hex). */
  dataStreamsFeedId?: string;
  /** On-chain Chainlink equity feed address. */
  chainlinkFeedAddress?: `0x${string}`;
  /** On-chain Chainlink feed decimals (default 8). */
  chainlinkFeedDecimals?: number;
  /** Pyth price id (hex). */
  pythPriceId?: string;
}
