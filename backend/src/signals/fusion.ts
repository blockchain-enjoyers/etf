import type { OracleReading } from "./oracle-adapter.js";

const BPS = 10_000n;

/** Median of bigints (floor of the mean of the two middles for even counts). */
export function robustMedian(values: bigint[]): bigint {
  if (values.length === 0) throw new Error("robustMedian: empty input");
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

export interface FusionOutput {
  reading: OracleReading & { estimated?: boolean };
  diverged: boolean;
  /** Max observed deviation from the median, in basis points. */
  maxDeviationBps: bigint;
}

/** Absolute deviation of `price` from `median`, expressed in bps of the median. */
function deviationBps(price: bigint, median: bigint): bigint {
  if (median === 0n) return 0n;
  const diff = price > median ? price - median : median - price;
  return (diff * BPS) / median;
}

/**
 * Fuse healthy readings via robust median + divergence guard.
 * - price = median of source prices
 * - if any source deviates beyond maxDivergenceBps → diverged: estimated=true, band widened
 * - confidence = max(source confidences, widened by the max deviation when diverged)
 * Picks the freshest source's marketStatus; source label = the median contributor's source.
 */
export function fuseReadings(
  readings: OracleReading[],
  maxDivergenceBps: bigint,
): FusionOutput {
  if (readings.length === 0) throw new Error("fuseReadings: no readings");

  const prices = readings.map((r) => r.price);
  const median = robustMedian(prices);

  let maxDeviationBps = 0n;
  for (const p of prices) {
    const d = deviationBps(p, median);
    if (d > maxDeviationBps) maxDeviationBps = d;
  }
  const diverged = readings.length > 1 && maxDeviationBps > maxDivergenceBps;

  // Pick the contributor closest to the median as the canonical source/timestamp.
  let canonical = readings[0]!;
  let bestDelta: bigint | null = null;
  let freshest = readings[0]!;
  for (const r of readings) {
    const delta = deviationBps(r.price, median);
    if (bestDelta === null || delta < bestDelta) {
      bestDelta = delta;
      canonical = r;
    }
    if (r.timestamp > freshest.timestamp) freshest = r;
  }

  const baseConfidence = readings.reduce((m, r) => (r.confidence > m ? r.confidence : m), 0n);
  // When diverged, widen the band by the median * maxDeviation so the uncertainty is honest.
  const widen = diverged ? (median * maxDeviationBps) / BPS : 0n;
  const confidence = baseConfidence + widen;

  return {
    reading: {
      price: median,
      confidence,
      timestamp: freshest.timestamp,
      marketStatus: freshest.marketStatus,
      source: canonical.source,
      estimated: diverged,
    },
    diverged,
    maxDeviationBps,
  };
}
