import { cn } from "../lib/cn";
import { Dot } from "./Dot";
import type { MarketStatus } from "@meridian/sdk";

const statusLabel: Record<MarketStatus, string> = {
  unknown: "Unknown",
  preMarket: "Pre-market",
  regular: "Open",
  postMarket: "Post-market",
  overnight: "Overnight",
  closed: "Closed",
};

type DotVariant = "open" | "closed" | "halt";

const statusDot: Record<MarketStatus, DotVariant> = {
  unknown: "halt",
  preMarket: "halt",
  regular: "open",
  postMarket: "halt",
  overnight: "halt",
  closed: "closed",
};

interface MarketStatusWidgetProps {
  status: MarketStatus;
  estimated?: boolean;
  className?: string;
}

export function MarketStatusWidget({ status, estimated = false, className }: MarketStatusWidgetProps) {
  return (
    <div
      aria-label={`market status: ${statusLabel[status]}`}
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      <Dot variant={statusDot[status]} />
      <span className="text-[12px] text-txt2">
        {statusLabel[status]}
        {estimated && <span className="ml-1 text-[10px] text-amber">~est</span>}
      </span>
    </div>
  );
}
