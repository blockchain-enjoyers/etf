import { describe, expect, it } from "vitest";
import { MarketStatus } from "../domain/market-status.js";
import { MarketStatusService } from "./market-status.service.js";

const STALE = 120; // seconds

function svc() {
  return new MarketStatusService(STALE);
}

describe("MarketStatusService (FSM)", () => {
  it("OPEN: a fresh Regular reading stays Regular", () => {
    const now = 1_750_000_000;
    const s = svc().resolve({ feedStatus: MarketStatus.Regular, readingTimestamp: now - 5, now });
    expect(s.status).toBe(MarketStatus.Regular);
    expect(s.degraded).toBe(false);
  });

  it("WEEKEND-STALE: a Closed reading that is old is reported Closed + degraded (estimated)", () => {
    const now = 1_750_000_000;
    const s = svc().resolve({
      feedStatus: MarketStatus.Closed,
      readingTimestamp: now - 3 * 24 * 3600,
      now,
    });
    expect(s.status).toBe(MarketStatus.Closed);
    expect(s.degraded).toBe(true);
  });

  it("STALE-WHILE-REGULAR: a Regular feed whose reading is older than the threshold degrades to Unknown", () => {
    const now = 1_750_000_000;
    const s = svc().resolve({
      feedStatus: MarketStatus.Regular,
      readingTimestamp: now - (STALE + 60),
      now,
    });
    expect(s.status).toBe(MarketStatus.Unknown);
    expect(s.degraded).toBe(true);
  });

  it("HALT: an Unknown feed code is always degraded regardless of freshness", () => {
    const now = 1_750_000_000;
    const s = svc().resolve({ feedStatus: MarketStatus.Unknown, readingTimestamp: now, now });
    expect(s.status).toBe(MarketStatus.Unknown);
    expect(s.degraded).toBe(true);
  });

  it("worst-of fold over constituents: any non-Regular makes the basket non-Regular + degraded", () => {
    const basket = svc().fold([
      { status: MarketStatus.Regular, degraded: false },
      { status: MarketStatus.Closed, degraded: true },
      { status: MarketStatus.Regular, degraded: false },
    ]);
    expect(basket.status).toBe(MarketStatus.Closed);
    expect(basket.degraded).toBe(true);
  });

  it("worst-of fold of all-Regular stays Regular + not degraded", () => {
    const basket = svc().fold([
      { status: MarketStatus.Regular, degraded: false },
      { status: MarketStatus.Regular, degraded: false },
    ]);
    expect(basket.status).toBe(MarketStatus.Regular);
    expect(basket.degraded).toBe(false);
  });
});
