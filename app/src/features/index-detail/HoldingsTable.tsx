import type { HoldingRow } from "@meridian/sdk";
import { TokenIcon } from "../../components/TokenIcon";
import { formatQty, formatUsd } from "../../lib/format";

interface Props {
  rows: HoldingRow[];
}

const TH = "text-txt3 font-semibold text-[9px] uppercase tracking-wider px-2.5 py-1.5 border-b border-line whitespace-nowrap";
const TD = "px-2.5 py-[7px] border-b border-line-soft align-middle whitespace-nowrap";

function bpsToPct(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

function driftLabel(bps: number): string {
  const pct = bps / 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function HoldingsTable({ rows }: Props) {
  return (
    <table data-testid="holdings-table" className="w-full border-collapse text-[11.5px]">
      <thead>
        <tr>
          <th className={`${TH} text-left`}>Constituent</th>
          <th className={`${TH} text-right`}>Qty / unit</th>
          <th className={`${TH} text-right`}>Value</th>
          <th className={`${TH} text-right`}>Cur %</th>
          <th className={`${TH} text-right`}>Tgt %</th>
          <th className={`${TH} text-right`}>Drift</th>
          <th className={`${TH} text-left`}>Weight</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const over = r.driftBps > 0;
          const curWidth = Math.max(0, Math.min(100, r.currentWeightBps / 100));
          const tgtLeft = Math.max(0, Math.min(100, r.targetWeightBps / 100));
          const hasDrift = r.driftBps !== 0;
          return (
            <tr key={r.token} className="hover:bg-surface2">
              <td className={TD}>
                <span className="flex items-center gap-2 font-semibold text-txt">
                  <TokenIcon token={r.token} symbol={r.symbol} />
                  {r.symbol}
                </span>
              </td>
              <td className={`${TD} text-right font-mono text-txt2 tabular-nums`}>{formatQty(r.qtyPerUnit)}</td>
              <td className={`${TD} text-right font-mono tabular-nums`}>
                <span className="inline-flex items-center gap-1">
                  {r.estimated && <span aria-hidden className="text-txt3">≈</span>}
                  {formatUsd(r.valuePerUnitUsd)}
                </span>
              </td>
              <td className={`${TD} text-right font-mono text-txt2 tabular-nums`}>{bpsToPct(r.currentWeightBps)}</td>
              <td className={`${TD} text-right font-mono text-txt2 tabular-nums`}>{bpsToPct(r.targetWeightBps)}</td>
              <td className={`${TD} text-right font-mono tabular-nums`}>
                {hasDrift ? (
                  <span className={over ? "text-amber" : r.driftBps < 0 ? "text-txt2" : "text-emerald"}>
                    {driftLabel(r.driftBps)}
                    {over ? " ⚑" : ""}
                  </span>
                ) : (
                  <span className="text-txt3">—</span>
                )}
              </td>
              <td className={TD}>
                <div className="relative h-[7px] w-[88px] rounded bg-surface3">
                  <span
                    className="absolute inset-y-0 left-0 rounded"
                    style={{ width: `${curWidth}%`, background: over ? "linear-gradient(90deg,#ffb020,#ff9500)" : "var(--color-cyan)" }}
                  />
                  <span className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded bg-txt" style={{ left: `${tgtLeft}%` }} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
