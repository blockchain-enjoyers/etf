import { describe, expect, it } from "vitest";
import { MarketStatus } from "../domain/market-status.js";
import { OracleSource } from "../domain/oracle.js";
import { fuseReadings, robustMedian } from "./fusion.js";
import type { OracleReading } from "./oracle-adapter.js";

function reading(price: bigint, source: OracleSource | string): OracleReading {
  return {
    price,
    confidence: price / 1000n,
    timestamp: 1_700_000_000,
    marketStatus: MarketStatus.Regular,
    source: source as OracleSource,
  };
}

describe("robustMedian", () => {
  it("returns the middle element for odd counts", () => {
    expect(robustMedian([3n, 1n, 2n])).toBe(2n);
  });
  it("averages the two middles for even counts", () => {
    expect(robustMedian([1n, 2n, 3n, 4n])).toBe(2n); // (2+3)/2 = 2 (floor)
  });
  it("throws on empty input", () => {
    expect(() => robustMedian([])).toThrow();
  });
});

describe("fuseReadings", () => {
  const maxDivergenceBps = 100n; // 1%

  it("agreeing sources → not estimated, tight band, median price", () => {
    const out = fuseReadings(
      [reading(100_000000000000000000n, "Chainlink"), reading(100_500000000000000000n, "Pyth")],
      maxDivergenceBps,
    );
    expect(out.diverged).toBe(false);
    expect(out.reading.estimated ?? false).toBe(false);
    expect(out.reading.price).toBe(robustMedian([
      100_000000000000000000n,
      100_500000000000000000n,
    ]));
  });

  it("one wild source beyond threshold → diverged, estimated, widened band", () => {
    const out = fuseReadings(
      [
        reading(100_000000000000000000n, "Chainlink"),
        reading(100_200000000000000000n, "Pyth"),
        reading(130_000000000000000000n, "PerpMark"),
      ],
      maxDivergenceBps,
    );
    expect(out.diverged).toBe(true);
    expect(out.reading.estimated).toBe(true);
    expect(out.reading.confidence).toBeGreaterThan(reading(100_000000000000000000n, "x").confidence);
  });

  it("single source → no divergence possible, passes through", () => {
    const out = fuseReadings([reading(100_000000000000000000n, "Chainlink")], maxDivergenceBps);
    expect(out.diverged).toBe(false);
    expect(out.reading.price).toBe(100_000000000000000000n);
  });

  it("empty set → throws (router falls back to last-close)", () => {
    expect(() => fuseReadings([], maxDivergenceBps)).toThrow();
  });
});
