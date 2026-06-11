import { MarketStatus } from "../domain/market-status.js";

const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** NYSE session approximation (no holiday table — a holiday behaves like a closed day). */
export function marketStatusNow(date: Date = new Date()): MarketStatus {
  const parts = FMT.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return MarketStatus.Closed;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  if (mins >= 570 && mins < 960) return MarketStatus.Regular;     // 9:30–16:00 ET
  if (mins >= 240 && mins < 570) return MarketStatus.PreMarket;   // 4:00–9:30 ET
  if (mins >= 960 && mins < 1200) return MarketStatus.PostMarket; // 16:00–20:00 ET
  return MarketStatus.Closed;
}
