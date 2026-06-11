import { formatUnits } from "viem";
import { cn } from "../lib/cn";
import type { HistoryPoint } from "@meridian/sdk";

// Inline-SVG sparkline (no heavy grid / attribution) with light price (Y) + time (X) labels.
// preserveAspectRatio="none" stretches the fixed viewBox to the container; vector-effect keeps
// strokes crisp. Labels + endpoint dot are HTML overlays so text/circles aren't squashed by the
// non-uniform scale.
const VB_W = 600;
const VB_H = 160;
const PAD_Y = 16;

interface PriceChartProps {
  data: HistoryPoint[];
  estimated?: boolean;
  /** true when `data` is a synthesized placeholder series (no real history) — shows a "sample" tag. */
  sample?: boolean;
  className?: string;
}

interface Pt {
  t: number;
  v: number;
}

function toPoints(data: HistoryPoint[]): Pt[] {
  const pts = data
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map((p) => {
      let v = 0;
      try {
        v = parseFloat(formatUnits(BigInt(p.nav), 18));
      } catch {
        v = 0;
      }
      return { t: p.timestampMs, v };
    });
  // collapse same-second points (keep last)
  const out: Pt[] = [];
  for (const p of pts) {
    const sec = Math.floor(p.t / 1000);
    if (out.length > 0 && Math.floor(out[out.length - 1]!.t / 1000) === sec) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

function fmtUsd(v: number): string {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
}

function fmtAxisTime(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs <= 2 * 24 * 3600 * 1000) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function PriceChart({ data, estimated = false, sample = false, className }: PriceChartProps) {
  const points = toPoints(data);
  const n = points.length;
  const values = points.map((p) => p.v);
  const min = n > 0 ? Math.min(...values) : 0;
  const max = n > 0 ? Math.max(...values) : 0;
  const span = max - min;

  const xAt = (i: number) => (n <= 1 ? VB_W : (i / (n - 1)) * VB_W);
  const yAt = (v: number) =>
    span === 0 ? VB_H / 2 : VB_H - PAD_Y - ((v - min) / span) * (VB_H - 2 * PAD_Y);

  let linePath = "";
  if (n === 1) {
    const yy = yAt(values[0]!).toFixed(1);
    linePath = `M0,${yy} L${VB_W},${yy}`;
  } else if (n > 1) {
    linePath = values
      .map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
      .join(" ");
  }
  const areaPath = linePath ? `${linePath} L${VB_W},${VB_H} L0,${VB_H} Z` : "";
  const lastY = n > 0 ? yAt(values[n - 1]!) : VB_H / 2;
  const gridYs = [0.25, 0.5, 0.75].map((f) => PAD_Y + f * (VB_H - 2 * PAD_Y));

  const spanMs = n > 1 ? points[n - 1]!.t - points[0]!.t : 0;
  const xLabels =
    n > 1
      ? [0, Math.floor((n - 1) / 2), n - 1].map((i) => ({
          label: fmtAxisTime(points[i]!.t, spanMs),
        }))
      : [];
  const yLabels =
    n > 0 && span > 0
      ? [
          { topPct: (PAD_Y / VB_H) * 100, label: fmtUsd(max) },
          { topPct: 50, label: fmtUsd((min + max) / 2) },
          { topPct: ((VB_H - PAD_Y) / VB_H) * 100, label: fmtUsd(min) },
        ]
      : n > 0
        ? [{ topPct: 50, label: fmtUsd(values[0]!) }]
        : [];

  return (
    <div
      role="img"
      aria-label={`price chart${estimated ? " (estimated)" : ""}`}
      data-testid="price-chart"
      className={cn("flex w-full flex-col", className)}
    >
      <div className="relative min-h-0 flex-1">
        <svg
          className="block h-full w-full"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <linearGradient id="pc-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-cyan)" stopOpacity={estimated ? 0.1 : 0.2} />
              <stop offset="1" stopColor="var(--color-cyan)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridYs.map((gy) => (
            <line
              key={gy}
              x1="0"
              y1={gy}
              x2={VB_W}
              y2={gy}
              stroke="var(--color-line-soft)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {areaPath && <path d={areaPath} fill="url(#pc-area)" />}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="var(--color-cyan)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={estimated ? "5 4" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {yLabels.map((yl) => (
          <span
            key={yl.label + yl.topPct}
            className="pointer-events-none absolute right-1 -translate-y-1/2 rounded bg-surface/80 px-1 font-mono text-[9px] text-txt3"
            style={{ top: `${yl.topPct}%` }}
          >
            {yl.label}
          </span>
        ))}
        {n > 0 && (
          <span
            className="pointer-events-none absolute block h-2 w-2 rounded-full bg-cyan shadow-[0_0_8px_#35d0e0]"
            style={{ right: 0, top: `${(lastY / VB_H) * 100}%`, transform: "translate(50%,-50%)" }}
          />
        )}
        {n === 0 && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] text-txt3">
            No price history yet
          </span>
        )}
      </div>
      {xLabels.length > 0 && (
        <div className="flex justify-between px-0.5 pt-1 font-mono text-[9px] text-txt3">
          {xLabels.map((xl, i) => (
            <span key={`${xl.label}-${i}`}>{xl.label}</span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between px-0.5 pt-1 font-mono text-[10px] text-txt3">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0 w-3.5 border-t-2 border-cyan"
            style={estimated ? { borderTopStyle: "dashed" } : undefined}
          />
          NAV{estimated ? " (estimate when closed)" : ""}
        </span>
        <span className="flex items-center gap-1.5">
          {sample && (
            <span className="rounded border border-amber/40 bg-amber/[0.1] px-1 text-amber">sample</span>
          )}
          {n === 0 ? "no history yet" : estimated ? "~est" : "live"}
        </span>
      </div>
    </div>
  );
}
