import type { MarketStatus } from "@meridian/sdk";
import { cn } from "../lib/cn";
import { STATUS_LABEL } from "../lib/market-status-label";
import { useStatusView } from "../status/StatusViewContext";

const SEG = "flex items-center gap-1.5 px-3.5 h-full border-r border-line";

export function StatusBar({ marketStatus, block = "—", navFreshness }: { marketStatus: MarketStatus | null; block?: string; navFreshness?: string }) {
  const open = marketStatus === "regular";
  const label = STATUS_LABEL[marketStatus ?? "unknown"];
  // Guarded read: StatusBar must still render in isolation (no StatusView provider).
  const { view } = useStatusView();
  return (
    <div className="fixed bottom-0 inset-x-0 h-[30px] z-50 bg-[#070809] border-t border-line flex items-center font-mono text-[10.5px] text-txt2">
      <div className={SEG}><span className="w-1.5 h-1.5 rounded-full bg-cyan" /> CHAIN <b className="text-txt">Robinhood Chain</b></div>
      <div className={SEG}>BLOCK <b className="text-txt">{block}</b></div>
      <div className={SEG}>
        <span className={cn("w-1.5 h-1.5 rounded-full", open ? "bg-emerald" : "bg-amber")} />
        MARKET <b className={open ? "text-emerald" : "text-amber"}>{label}</b>
      </div>
      {navFreshness && <div className={SEG}>NAV <b className="text-txt">{navFreshness}</b></div>}
      <div className={SEG}>
        VIEW {view && <b className="text-cyan">{view}</b>}
      </div>
      <div className={cn(SEG, "ml-auto border-r-0 border-l border-line")}>FEE <b className="text-emerald">0%</b> protocol</div>
    </div>
  );
}
