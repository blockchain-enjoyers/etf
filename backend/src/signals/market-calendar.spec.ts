import { describe, expect, it } from "vitest";
import { MarketStatus } from "../domain/market-status.js";
import { marketStatusNow } from "./market-calendar.js";

// 2026-06-10 is a Wednesday. 14:30Z = 10:30 ET (EDT, UTC-4) → Regular.
describe("marketStatusNow", () => {
  it("weekday regular session (ET) → Regular", () => {
    expect(marketStatusNow(new Date("2026-06-10T14:30:00Z"))).toBe(MarketStatus.Regular);
    expect(marketStatusNow(new Date("2026-06-10T19:59:00Z"))).toBe(MarketStatus.Regular); // 15:59 ET
  });
  it("pre/post market windows", () => {
    expect(marketStatusNow(new Date("2026-06-10T12:00:00Z"))).toBe(MarketStatus.PreMarket);  // 8:00 ET
    expect(marketStatusNow(new Date("2026-06-10T21:00:00Z"))).toBe(MarketStatus.PostMarket); // 17:00 ET
  });
  it("night + weekend → Closed", () => {
    expect(marketStatusNow(new Date("2026-06-10T06:00:00Z"))).toBe(MarketStatus.Closed); // 2:00 ET
    expect(marketStatusNow(new Date("2026-06-13T15:00:00Z"))).toBe(MarketStatus.Closed); // Saturday
    expect(marketStatusNow(new Date("2026-06-14T15:00:00Z"))).toBe(MarketStatus.Closed); // Sunday
  });
  it("winter time (EST, UTC-5): 14:30Z = 9:30 ET → Regular boundary", () => {
    expect(marketStatusNow(new Date("2026-01-14T14:30:00Z"))).toBe(MarketStatus.Regular);
    expect(marketStatusNow(new Date("2026-01-14T14:29:00Z"))).toBe(MarketStatus.PreMarket);
  });
});
