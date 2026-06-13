import { describe, it, expect } from "vitest";
import { aggregate, DEFAULT_PARAMS } from "./price-safety.js";
const E18 = 10n ** 18n;
const src = (p: number, d = 5_000_000) => ({ price: BigInt(p) * E18, depth: BigInt(d) * E18, lastUpdate: 1000, healthy: true });
const P = { ...DEFAULT_PARAMS, nowSec: 1000 };
describe("price-safety aggregate", () => {
  it("all agree -> safe, median = price", () => {
    const r = aggregate([src(100), src(100), src(100)], P);
    expect(r.median).toBe(100n * E18); expect(r.safe).toBe(true); expect(r.dropped).toEqual([]);
  });
  it("one >2% outlier is dropped, median holds, still safe (2 survive)", () => {
    const r = aggregate([src(100), src(100), src(130)], P);
    expect(r.median).toBe(100n * E18); expect(r.dropped).toEqual([2]); expect(r.safe).toBe(true);
  });
  it("two diverge -> <2 survivors -> unsafe", () => {
    const r = aggregate([src(100), src(130), src(160)], P);
    expect(r.safe).toBe(false);
  });
  it("weight cap pulls the median off a deep source's price (102 -> 101)", () => {
    // Without the 40% cap the 5x-deep source at 102 would pin the median to 102;
    // the cap (converges within 20 passes at this moderate ratio) moves it to 101. All kept.
    const r = aggregate([src(100, 1), src(101, 1), src(102, 5)], P);
    expect(r.median).not.toBe(102n * E18);
    expect(r.median).toBe(101n * E18);
    expect(r.dropped).toEqual([]);
  });
  it("stale source dropped", () => {
    const r = aggregate([src(100), src(100), { ...src(100), lastUpdate: 1000 - 99999 }], { ...P, nowSec: 1000 + 0 });
    expect(r.safe).toBe(true);
  });
});
