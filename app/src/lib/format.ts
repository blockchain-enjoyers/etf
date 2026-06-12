function parse18Dec(value18dec: string): number {
  const raw = BigInt(value18dec);
  const whole = raw / BigInt(1e18);
  const frac = raw % BigInt(1e18);
  return Number(whole) + Number(frac) / 1e18;
}

export function formatUsd(value18dec: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parse18Dec(value18dec));
}

export function formatQty(value18dec: string): string {
  const n = parse18Dec(value18dec);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

export function formatSignedPctFromBps(bps: number): string {
  const pct = bps / 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

// Fee bps → unsigned percent, e.g. 15 → "0.15%". Trims trailing-zero noise (50 → "0.5%", 100 → "1%").
export function formatBpsPct(bps: number): string {
  const pct = bps / 100;
  const s = pct.toFixed(2).replace(/\.?0+$/, "");
  return `${s}%`;
}

export function timeAgo(ms: number): string {
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function shortenAddress(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
