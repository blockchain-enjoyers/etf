import { describe, expect, it } from "vitest";
import { rebalanceKey, settleEntryKey } from "./idempotency.js";

describe("keeper idempotency keys", () => {
  it("rebalance key is per-basket per-UTC-day (one rebalance/day singleton)", () => {
    const a = rebalanceKey("0xbeef", new Date("2026-06-05T10:00:00Z"));
    const b = rebalanceKey("0xbeef", new Date("2026-06-05T23:00:00Z"));
    const c = rebalanceKey("0xbeef", new Date("2026-06-06T01:00:00Z"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("settle entry key is per basket+nonce", () => {
    expect(settleEntryKey("0xbeef", 7n)).toBe("settle:0xbeef:7");
    expect(settleEntryKey("0xbeef", 8n)).not.toBe(settleEntryKey("0xbeef", 7n));
  });
});
