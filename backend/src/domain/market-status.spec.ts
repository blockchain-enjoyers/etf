import { describe, expect, it } from "vitest";
import {
  MarketStatus,
  isTradeable,
  marketStatusFromFeedCode,
  marketStatusToPrisma,
  prismaToMarketStatus,
} from "./market-status.js";

describe("MarketStatus", () => {
  it("maps the Chainlink Data Streams marketStatus codes 0-5", () => {
    expect(marketStatusFromFeedCode(0)).toBe(MarketStatus.Unknown);
    expect(marketStatusFromFeedCode(1)).toBe(MarketStatus.PreMarket);
    expect(marketStatusFromFeedCode(2)).toBe(MarketStatus.Regular);
    expect(marketStatusFromFeedCode(3)).toBe(MarketStatus.PostMarket);
    expect(marketStatusFromFeedCode(4)).toBe(MarketStatus.Overnight);
    expect(marketStatusFromFeedCode(5)).toBe(MarketStatus.Closed);
  });

  it("treats an out-of-range feed code as Unknown (degraded, never throws)", () => {
    expect(marketStatusFromFeedCode(99)).toBe(MarketStatus.Unknown);
    expect(marketStatusFromFeedCode(-1)).toBe(MarketStatus.Unknown);
  });

  it("considers only Regular tradeable (the only state v1 trusts)", () => {
    expect(isTradeable(MarketStatus.Regular)).toBe(true);
    expect(isTradeable(MarketStatus.PreMarket)).toBe(false);
    expect(isTradeable(MarketStatus.PostMarket)).toBe(false);
    expect(isTradeable(MarketStatus.Overnight)).toBe(false);
    expect(isTradeable(MarketStatus.Closed)).toBe(false);
    expect(isTradeable(MarketStatus.Unknown)).toBe(false);
  });

  it("round-trips to and from the Prisma enum string", () => {
    for (const s of Object.values(MarketStatus)) {
      expect(prismaToMarketStatus(marketStatusToPrisma(s))).toBe(s);
    }
    expect(marketStatusToPrisma(MarketStatus.Regular)).toBe("Regular");
  });
});
