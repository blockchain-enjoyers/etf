import { Injectable } from "@nestjs/common";
import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  type IPolicy,
  TimeoutStrategy,
  circuitBreaker,
  handleAll,
  retry,
  timeout,
  wrap,
} from "cockatiel";
import { MarketStatus } from "../domain/market-status.js";
import { type OracleReading, OracleSource } from "../domain/oracle.js";
import { fuseReadings } from "./fusion.js";
import { MarketStatusService } from "./market-status.service.js";
import type { OracleAdapter } from "./oracle-adapter.js";

export interface SequencerCheck {
  ok: boolean;
  reason?: string;
}

/** L2 sequencer-uptime gate. Checked BEFORE any on-chain source is trusted. [spec §8, R7] */
export interface SequencerGate {
  check(): Promise<SequencerCheck>;
}

export interface SignalRouterOptions {
  /** Sources that read on-chain and therefore require a healthy sequencer. */
  onChainSources: Set<OracleSource>;
  /**
   * Optional fusion config (additive — used by Plan D's `fuseToReading` multi-source
   * fusion stage). Max allowed deviation from the median before sources are deemed
   * divergent. Unused by v1's single-source `getReading` fallback path.
   */
  maxDivergenceBps?: bigint;
}

/** The canonical fallback ordering. Chainlink first, LastClose synthesized last. [R5] */
const FALLBACK_ORDER: OracleSource[] = [
  OracleSource.Chainlink,
  OracleSource.Pyth,
  OracleSource.RedStone,
  OracleSource.DexTwap,
  OracleSource.PerpMark,
  OracleSource.LastClose,
];

@Injectable()
export class SignalRouter {
  /**
   * Ordered list of all registered adapters. Using a list (not a Map keyed by source) so that
   * multiple adapters sharing the same OracleSource (e.g. ChainlinkDataStreams + ChainlinkFeed,
   * both with source === OracleSource.Chainlink) are ALL reachable — resolves I-1 collision.
   */
  private readonly adapterList: OracleAdapter[];
  /**
   * Per-adapter cockatiel policy. Keyed by list index (not source) so two adapters with the same
   * source each get an independent breaker/retry/timeout policy.
   */
  private readonly policyByIndex = new Map<number, IPolicy>();

  constructor(
    adapters: OracleAdapter[],
    private readonly marketStatus: MarketStatusService,
    private readonly sequencer: SequencerGate,
    private readonly clock: () => number,
    private readonly options: SignalRouterOptions,
  ) {
    this.adapterList = [...adapters];
    // Per-adapter resilience: retry with backoff, then a circuit-breaker, then a timeout.
    for (let i = 0; i < adapters.length; i++) {
      const policy = wrap(
        retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff({ maxDelay: 2000 }) }),
        circuitBreaker(handleAll, {
          halfOpenAfter: 10_000,
          breaker: new ConsecutiveBreaker(5),
        }),
        timeout(3000, TimeoutStrategy.Aggressive),
      );
      this.policyByIndex.set(i, policy);
    }
  }

  /**
   * Walk the fallback ordering, returning the first usable reading. On-chain sources are skipped
   * when the sequencer is down. A degraded/stale reading still wins if nothing better exists, but is
   * marked `estimated`. If nothing is usable, synthesize a LastClose/Unknown estimated reading.
   *
   * The fallback ordering is determined by FALLBACK_ORDER priority: for each priority source,
   * the FIRST adapter in the registered list with that source is tried. This preserves the
   * single-source fallback semantics while allowing multiple adapters per source in the list.
   */
  async getReading(token: string): Promise<NavReading> {
    const now = this.clock();
    let sequencerOk: boolean | undefined;

    for (const source of FALLBACK_ORDER) {
      // Find the first adapter in the registered list with this source (priority order is list order
      // within the same source; FALLBACK_ORDER determines cross-source priority).
      const idx = this.adapterList.findIndex((a) => a.source === source);
      if (idx === -1) continue;
      const adapter = this.adapterList[idx]!;

      if (this.options.onChainSources.has(source)) {
        sequencerOk ??= (await this.sequencer.check()).ok;
        if (!sequencerOk) continue; // sequencer down → never trust an on-chain source
      }

      const policy = this.policyByIndex.get(idx);
      let reading: OracleReading | undefined;
      try {
        reading = policy ? await policy.execute(() => adapter.read(token)) : await adapter.read(token);
      } catch {
        continue; // retries + breaker exhausted → fall through to the next source
      }
      if (!reading) continue;

      const res = this.marketStatus.resolve({
        feedStatus: reading.marketStatus,
        readingTimestamp: reading.timestamp,
        now,
      });
      return {
        price: reading.price,
        confidence: reading.confidence,
        timestamp: reading.timestamp,
        marketStatus: res.status,
        source: reading.source,
        estimated: res.degraded,
      };
    }

    // Nothing usable: degrade, don't crash. Synthesize an estimated last-close reading.
    return {
      price: 0n,
      confidence: 0n,
      timestamp: now,
      marketStatus: MarketStatus.Unknown,
      source: OracleSource.LastClose,
      estimated: true,
    };
  }

  /**
   * Fusion mode: gather ALL healthy sources (each guarded by the same per-adapter cockatiel policy
   * the fallback `getReading` uses), fuse via robust median + divergence guard. Falls back to the
   * single healthy source when fewer than 2 succeed; throws only when none succeed (caller degrades
   * to last-close). The divergence threshold comes from `options.maxDivergenceBps` (default applied
   * by the factory); if it is unset, no divergence is flagged.
   *
   * Because adapters are stored as an ordered list (not a source-keyed Map), ALL adapters — including
   * two Chainlink adapters (DS + on-chain feed) with the same source value — are iterated and
   * contribute their readings to the fusion pool independently.
   */
  async fuseToReading(token: string): Promise<OracleReading & { estimated?: boolean }> {
    const healthy: OracleReading[] = [];
    for (let i = 0; i < this.adapterList.length; i++) {
      const adapter = this.adapterList[i]!;
      const policy = this.policyByIndex.get(i);
      try {
        const reading = policy
          ? await policy.execute(() => adapter.read(token))
          : await adapter.read(token);
        if (reading) healthy.push(reading);
      } catch {
        // Source down/stale → skip; divergence/degrade handled by the fusion + fallback below.
      }
    }
    if (healthy.length === 0) {
      throw new Error("SignalRouter.fuseToReading: no healthy sources");
    }
    if (healthy.length === 1) {
      return { ...healthy[0]!, estimated: healthy[0]!.marketStatus !== MarketStatus.Regular };
    }
    const fused = fuseReadings(healthy, this.options.maxDivergenceBps ?? 0n);
    return fused.reading;
  }
}

/** A reading enriched with the FSM verdict (estimated). Per-token input to NavEngineService. */
export interface NavReading {
  price: bigint;
  confidence: bigint;
  timestamp: number;
  marketStatus: MarketStatus;
  source: OracleSource;
  estimated: boolean;
}
