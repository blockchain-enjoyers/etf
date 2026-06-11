import { NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useFeed } from "../data/useFeed";
import { cn } from "../lib/cn";
import { STATUS_LABEL } from "../lib/market-status-label";
import type { MarketStatus } from "@meridian/sdk";

const LINKS = [
  { to: "/explore", label: "Markets" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/activity", label: "Activity" },
  { to: "/create", label: "Create" },
] as const;

export function TerminalHeader() {
  const { data: feed } = useFeed();
  const first = feed?.items[0];
  const status: MarketStatus = first?.marketStatus ?? "unknown";
  const open = status === "regular";

  return (
    <header className="flex items-center gap-4 px-[18px] py-2.5 border-b border-line bg-bg2 shrink-0">
      <div className="flex items-center gap-2 font-bold tracking-wide">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M2 18 L8 7 L12 13 L16 5 L22 18" stroke="#35d0e0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="8" cy="7" r="1.7" fill="#28e07b" />
          <circle cx="16" cy="5" r="1.7" fill="#9a7bff" />
        </svg>
        MERIDIAN <span className="font-mono text-[10px] tracking-widest uppercase text-txt3 font-medium">terminal</span>
      </div>
      <nav className="flex gap-0.5 ml-1.5">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              cn("text-xs px-2.5 py-1.5 rounded-md", isActive ? "bg-surface2 text-cyan shadow-[inset_0_-2px_0_#35d0e0]" : "text-txt2 hover:bg-surface hover:text-txt")
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1" />
      <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-md border text-[11.5px]", open ? "border-emerald/30 bg-emerald/[0.07]" : "border-line bg-surface")}>
        <span className={cn("w-1.5 h-1.5 rounded-full", open ? "bg-emerald shadow-[0_0_9px_#28e07b]" : "bg-amber")} />
        <span>Market <b className={open ? "text-emerald" : "text-amber"}>{STATUS_LABEL[status]}</b></span>
      </div>
      <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
    </header>
  );
}
