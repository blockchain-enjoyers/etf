import type { MarketStatus } from "@meridian/sdk";
import type { ReactNode } from "react";
import { EstBadge } from "./EstBadge";

export interface InstrumentStat {
  k: ReactNode;
  v: ReactNode;
}

export function InstrumentBar({
  symbol, name, navLabel, typeLabel, marketStatus, estimated, stats = [],
}: {
  symbol: string;
  name: string;
  navLabel: string;
  typeLabel: string;
  marketStatus: MarketStatus | null;
  estimated: boolean;
  stats?: InstrumentStat[];
}) {
  void marketStatus;
  return (
    <div className="flex items-stretch border-b border-line bg-bg2 overflow-x-auto">
      <div className="flex items-center gap-3.5 px-[18px] py-2.5 border-r border-line shrink-0">
        <div className="font-mono font-bold text-xl tracking-wide flex items-center gap-2">
          {symbol}
          <span className="font-mono text-[9px] tracking-widest text-violet border border-[#2c2740] bg-surface3 px-1.5 py-0.5 rounded">
            {typeLabel.toUpperCase()}
          </span>
        </div>
        <div className="text-txt2 text-xs">{name}</div>
      </div>
      <div className="flex items-stretch flex-1">
        <div className="px-[18px] py-2 border-r border-line-soft flex flex-col gap-px min-w-[118px]">
          <div className="text-[9.5px] uppercase tracking-wider text-txt3">NAV / unit</div>
          <div className="font-mono text-[15px] font-semibold flex items-center gap-1">
            {estimated && <span aria-hidden>≈</span>}
            {navLabel}
            {estimated && <EstBadge />}
          </div>
        </div>
        {stats.map((s, i) => (
          <div key={i} className="px-[18px] py-2 border-r border-line-soft flex flex-col gap-px min-w-[118px]">
            <div className="text-[9.5px] uppercase tracking-wider text-txt3">{s.k}</div>
            <div className="font-mono text-[15px] font-semibold tabular-nums">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
