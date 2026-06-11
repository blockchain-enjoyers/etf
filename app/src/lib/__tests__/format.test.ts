import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatUsd,
  formatQty,
  formatSignedPctFromBps,
  timeAgo,
  shortenAddress,
} from "../format";

const ONE_ETH = "1000000000000000000"; // 1 * 1e18

describe("formatUsd", () => {
  const cases: [string, string, string][] = [
    ["1 USD", ONE_ETH, "$1.00"],
    ["0.50 USD", "500000000000000000", "$0.50"],
    ["1234.56 USD", "1234560000000000000000", "$1,234.56"],
    ["zero", "0", "$0.00"],
  ];

  it.each(cases)("%s", (_label, input, expected) => {
    expect(formatUsd(input)).toBe(expected);
  });
});

describe("formatQty", () => {
  const cases: [string, string, string][] = [
    ["below 1", "500000000000000000", "0.5000"],
    ["1 unit", ONE_ETH, "1.0000"],
    ["1500 -> K", "1500000000000000000000", "1.50K"],
    ["2M", "2000000000000000000000000", "2.00M"],
  ];

  it.each(cases)("%s", (_label, input, expected) => {
    expect(formatQty(input)).toBe(expected);
  });
});

describe("formatSignedPctFromBps", () => {
  const cases: [string, number, string][] = [
    ["positive", 150, "+1.50%"],
    ["negative", -75, "-0.75%"],
    ["zero", 0, "0.00%"],
    ["large positive", 10000, "+100.00%"],
  ];

  it.each(cases)("%s", (_label, bps, expected) => {
    expect(formatSignedPctFromBps(bps)).toBe(expected);
  });
});

describe("timeAgo", () => {
  const FIXED = new Date("2026-06-05T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const cases: [string, number, string][] = [
    ["30 seconds", FIXED - 30_000, "30s ago"],
    ["5 minutes", FIXED - 5 * 60_000, "5m ago"],
    ["3 hours", FIXED - 3 * 3_600_000, "3h ago"],
    ["2 days", FIXED - 2 * 86_400_000, "2d ago"],
  ];

  it.each(cases)("%s ago", (_label, ms, expected) => {
    expect(timeAgo(ms)).toBe(expected);
  });
});

describe("shortenAddress", () => {
  const cases: [string, string, string][] = [
    [
      "full address",
      "0x1234567890abcdef1234567890abcdef12345678",
      "0x1234...5678",
    ],
    ["short passthrough", "0xabc", "0xabc"],
  ];

  it.each(cases)("%s", (_label, input, expected) => {
    expect(shortenAddress(input)).toBe(expected);
  });
});
