import { describe, expect, it } from "vitest";
import { CAPABILITY_MATRIX } from "./capability-matrix.js";

describe("CAPABILITY_MATRIX", () => {
  it("declares a degradation policy for every entry, and quote ports never fall back", () => {
    expect(CAPABILITY_MATRIX.length).toBeGreaterThan(0);
    for (const e of CAPABILITY_MATRIX) {
      expect(["live", "fallback", "null"]).toContain(e.l1Status);
    }
    const quotes = CAPABILITY_MATRIX.filter((e) => e.port === "RedeemQuote" || e.port === "CreateQuote");
    expect(quotes.length).toBe(2);
    for (const q of quotes) expect(q.absentPolicy).toBe("null"); // iron rule
  });
});

describe("CAPABILITY_MATRIX — L5 forward cash", () => {
  it("declares the ForwardCashQueue + BasketNavObserver capabilities, null when absent", () => {
    const l5 = CAPABILITY_MATRIX.filter(
      (e) => e.capability === "ForwardCashQueue" || e.capability === "BasketNavObserver",
    );
    expect(l5.length).toBe(2);
    for (const e of l5) {
      expect(e.level).toBe("L5");
      expect(e.l1Status).toBe("null"); // undeployed at L1
    }
  });
});
