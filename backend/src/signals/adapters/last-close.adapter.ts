import { MarketStatus } from "../../domain/market-status.js";
import { type OracleReading, OracleSource } from "../../domain/oracle.js";
import type { OracleAdapter } from "../oracle-adapter.js";

export interface LastCloseAnchorSource {
  /** Latest Regular, non-zero price for the token, or undefined. */
  lastRegular(token: string): Promise<{ price: bigint; timestampSec: number } | undefined>;
}

export interface LastCloseOptions {
  maxDriftBps: number;
  bandBps: number;
}

// Two incommensurate periods (1h / 3h) give a smooth non-repeating drift; phases from the token
// address keep tokens decorrelated. Deterministic: same clock ⇒ same price on every replica.
function walkBps(nowSec: number, token: string, maxBps: number): number {
  const seed = Number.parseInt(token.slice(-8), 16) || 0;
  const phi1 = (seed % 628) / 100;
  const phi2 = ((seed >> 8) % 628) / 100;
  const a1 = 0.6 * maxBps;
  const a2 = 0.4 * maxBps;
  return Math.round(a1 * Math.sin((2 * Math.PI * nowSec) / 3600 + phi1) + a2 * Math.sin((2 * Math.PI * nowSec) / 10800 + phi2));
}

export class LastCloseAdapter implements OracleAdapter {
  readonly source = OracleSource.LastClose;

  constructor(
    private readonly anchors: LastCloseAnchorSource,
    private readonly status: () => MarketStatus,
    private readonly clock: () => number,
    private readonly opts: LastCloseOptions,
  ) {}

  async read(token: string): Promise<OracleReading | undefined> {
    const anchor = await this.anchors.lastRegular(token);
    if (!anchor) return undefined;
    const status = this.status();
    if (status === MarketStatus.Regular) {
      // Feeds down during open hours: flat anchor, stale timestamp ⇒ FSM marks it degraded.
      return {
        price: anchor.price,
        confidence: (anchor.price * BigInt(this.opts.bandBps)) / 10_000n,
        timestamp: anchor.timestampSec,
        marketStatus: status,
        source: OracleSource.LastClose,
      };
    }
    const bps = walkBps(this.clock(), token, this.opts.maxDriftBps);
    const price = (anchor.price * BigInt(10_000 + bps)) / 10_000n;
    return {
      price,
      confidence: (price * BigInt(this.opts.bandBps)) / 10_000n,
      timestamp: this.clock(),
      marketStatus: status,
      source: OracleSource.LastClose,
    };
  }
}
