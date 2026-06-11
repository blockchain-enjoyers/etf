import type { MarketStatus } from "@meridian/sdk";

// Shared label map so every chrome surface (header, status bar, widgets) agrees.
// `regular` reads as "Open" everywhere — the binary open/closed phrasing is gone.
export const STATUS_LABEL: Record<MarketStatus, string> = {
  unknown: "Unknown",
  preMarket: "Pre-market",
  regular: "Open",
  postMarket: "Post-market",
  overnight: "Overnight",
  closed: "Closed",
};
