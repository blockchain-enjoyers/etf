import { describe, expect, it } from "vitest";
import { ConfidenceService } from "./confidence.service.js";

const ESTIMATED_BAND_BPS = 200; // +2% widening when estimated

function svc() {
  return new ConfidenceService(ESTIMATED_BAND_BPS);
}

describe("ConfidenceService", () => {
  it("returns [nav-band, nav+band] for a fresh (non-estimated) reading", () => {
    const { lower, upper } = svc().band({
      nav: 1_000_000_000_000_000_000_000n, // 1000.0
      summedBand: 10_000_000_000_000_000_000n, // 10.0
      estimated: false,
    });
    expect(lower).toBe(990_000_000_000_000_000_000n);
    expect(upper).toBe(1_010_000_000_000_000_000_000n);
  });

  it("widens the band by ESTIMATED_BAND_BPS of NAV when estimated", () => {
    const { lower, upper } = svc().band({
      nav: 1_000_000_000_000_000_000_000n, // 1000.0
      summedBand: 0n,
      estimated: true,
    });
    // +2% of 1000 = 20 → [980, 1020]
    expect(lower).toBe(980_000_000_000_000_000_000n);
    expect(upper).toBe(1_020_000_000_000_000_000_000n);
  });

  it("floors the lower bound at 0 (never negative)", () => {
    const { lower } = svc().band({
      nav: 5_000_000_000_000_000_000n, // 5.0
      summedBand: 10_000_000_000_000_000_000n, // 10.0 > nav
      estimated: false,
    });
    expect(lower).toBe(0n);
  });
});
