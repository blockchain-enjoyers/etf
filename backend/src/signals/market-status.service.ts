import { Injectable } from "@nestjs/common";
import { MarketStatus } from "../domain/market-status.js";

export interface StatusResolution {
  status: MarketStatus;
  /** true ⇒ not settlement-grade ⇒ NavResult.estimated must be true. */
  degraded: boolean;
}

export interface ResolveInput {
  /** marketStatus reported by the freshest usable reading. */
  feedStatus: MarketStatus;
  /** seconds — timestamp of that reading. */
  readingTimestamp: number;
  /** seconds — current time. */
  now: number;
}

/**
 * Per-token market-status FSM. Turns a raw feed status + reading age into a {status, degraded}
 * pair, and folds per-token resolutions into one basket status (worst-of). Mirrors the L4
 * FairValueNAV rule: any constituent not Regular ⇒ estimated. [spec §10, R5]
 */
@Injectable()
export class MarketStatusService {
  constructor(private readonly staleThresholdSeconds: number) {}

  resolve(input: ResolveInput): StatusResolution {
    const age = input.now - input.readingTimestamp;

    // Unknown feed code = halt/feed-error → always degraded.
    if (input.feedStatus === MarketStatus.Unknown) {
      return { status: MarketStatus.Unknown, degraded: true };
    }

    // A market the feed itself reports as not-Regular (pre/post/overnight/closed) is degraded,
    // but we keep that reported status so the API can show "weekend / after-hours".
    if (input.feedStatus !== MarketStatus.Regular) {
      return { status: input.feedStatus, degraded: true };
    }

    // Feed says Regular: trust it ONLY while the reading is fresh; otherwise degrade to Unknown.
    if (age > this.staleThresholdSeconds) {
      return { status: MarketStatus.Unknown, degraded: true };
    }
    return { status: MarketStatus.Regular, degraded: false };
  }

  /** Fold per-token resolutions into one basket-level status: worst-of, degraded if any is. */
  fold(parts: StatusResolution[]): StatusResolution {
    if (parts.length === 0) return { status: MarketStatus.Unknown, degraded: true };
    let status = MarketStatus.Regular;
    let degraded = false;
    for (const p of parts) {
      if (p.degraded) degraded = true;
      if (p.status !== MarketStatus.Regular) status = p.status; // report the (last) non-Regular state
    }
    return { status, degraded };
  }
}
