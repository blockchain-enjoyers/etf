export interface AggParams {
  maxWeightBps: bigint; divergenceBps: bigint; staleHorizon: bigint;
  dMin: bigint; wDisp: bigint; wDepth: bigint; wStale: bigint;
  maxSafeBandBps: bigint; minSafeSources: number; nowSec: number;
}
export const DEFAULT_PARAMS: AggParams = {
  maxWeightBps: 4000n, divergenceBps: 200n, staleHorizon: 3600n,
  dMin: 100_000n * 10n ** 18n, wDisp: 10000n, wDepth: 10000n, wStale: 10000n,
  maxSafeBandBps: 500n, minSafeSources: 2, nowSec: Math.floor(Date.now() / 1000),
};
export interface SourceInput { price: bigint; depth: bigint; lastUpdate: number; healthy: boolean }
export interface AggResult { median: bigint; bandBps: number; band: bigint; safe: boolean; kept: number[]; dropped: number[] }

function weightedMedian(prices: bigint[], depths: bigint[], maxWeightBps: bigint): bigint {
  for (let i = 1; i < prices.length; i++) {
    const p = prices[i]!, d = depths[i]!; let j = i;
    while (j > 0 && prices[j - 1]! > p) { prices[j] = prices[j - 1]!; depths[j] = depths[j - 1]!; j--; }
    prices[j] = p; depths[j] = d;
  }
  for (let pass = 0; pass < 20; pass++) {
    let total = 0n; for (const d of depths) total += d;
    if (total === 0n) break;
    const cap = (total * maxWeightBps) / 10000n; let changed = false;
    for (let i = 0; i < depths.length; i++) if (depths[i]! > cap) { depths[i] = cap; changed = true; }
    if (!changed) break;
  }
  let totalCapped = 0n; for (const d of depths) totalCapped += d;
  let cum = 0n;
  for (let i = 0; i < prices.length; i++) { cum += depths[i]!; if (cum * 2n >= totalCapped) return prices[i]!; }
  return prices[prices.length - 1]!;
}

export function aggregate(sources: SourceInput[], params: AggParams): AggResult {
  const p = params; const now = BigInt(p.nowSec);
  const idx: number[] = [], price: bigint[] = [], depth: bigint[] = []; let oldest = 2n ** 64n;
  sources.forEach((s, i) => {
    if (!s.healthy || s.price === 0n) return;
    if (BigInt(s.lastUpdate) < now && now - BigInt(s.lastUpdate) > p.staleHorizon) return;
    idx.push(i); price.push(s.price); depth.push(s.depth);
    if (BigInt(s.lastUpdate) < oldest) oldest = BigInt(s.lastUpdate);
  });
  if (price.length === 0) return { median: 0n, bandBps: 0, band: 0n, safe: false, kept: [], dropped: sources.map((_, i) => i) };
  const prov = weightedMedian([...price], [...depth], p.maxWeightBps);
  const keptIdx: number[] = [], kp: bigint[] = [], kd: bigint[] = [];
  idx.forEach((orig, i) => {
    const d = price[i]! > prov ? price[i]! - prov : prov - price[i]!;
    if (d * 10000n <= p.divergenceBps * prov) { keptIdx.push(orig); kp.push(price[i]!); kd.push(depth[i]!); }
  });
  const dropped = sources.map((_, i) => i).filter((i) => !keptIdx.includes(i));
  if (kp.length === 0) return { median: prov, bandBps: 10000, band: prov, safe: false, kept: [], dropped };
  const med = weightedMedian([...kp], [...kd], p.maxWeightBps);
  let totalDepth = 0n, wad = 0n;
  for (let i = 0; i < kp.length; i++) { totalDepth += kd[i]!; const diff = kp[i]! > med ? kp[i]! - med : med - kp[i]!; wad += diff * kd[i]!; }
  const dispRelBps = totalDepth === 0n ? 0n : (wad * 10000n) / (totalDepth * med);
  const depthPenaltyBps = totalDepth >= p.dMin ? 0n : ((p.dMin - totalDepth) * 10000n) / p.dMin;
  let stalePenaltyBps = 0n;
  if (now > oldest) { const age = now - oldest; stalePenaltyBps = age >= p.staleHorizon ? 10000n : (age * 10000n) / p.staleHorizon; }
  const combinedBps = (p.wDisp * dispRelBps + p.wDepth * depthPenaltyBps + p.wStale * stalePenaltyBps) / 10000n;
  const band = (med * combinedBps) / 10000n;
  const bandBps = med === 0n ? 0 : Number((band * 10000n) / med);
  const safe = keptIdx.length >= p.minSafeSources && BigInt(bandBps) <= p.maxSafeBandBps;
  return { median: med, bandBps, band, safe, kept: keptIdx, dropped };
}
