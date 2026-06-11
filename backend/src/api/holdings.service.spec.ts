import { describe, expect, it, vi } from "vitest";
import { HoldingsService } from "./holdings.service.js";

// Minimal stubs for the new deps (non-rebalance path never calls them).
const dummyChain = { publicClient: { multicall: vi.fn() } };
const dummyRebVault = { heldTokens: vi.fn() };

describe("HoldingsService", () => {
  it("computes value-based weights summing to ~10000 with real prices (non-rebalance)", async () => {
    const prisma = {
      basket: { findUnique: vi.fn().mockResolvedValue({
        vaultAddress: "0xv",
        vaultType: "Managed",
        constituents: [{ token: "0xa", unitQty: { toFixed: () => "1000000000000000000" } }, { token: "0xb", unitQty: { toFixed: () => "1000000000000000000" } }],
      }) },
      navSnapshot: { findFirst: vi.fn().mockResolvedValue({ nav: { toFixed: () => "300000000000000000000" }, estimated: false, timestamp: new Date(1) }) },
      priceSnapshot: { findFirst: vi.fn()
        .mockResolvedValueOnce({ price: { toFixed: () => "100000000000000000000" }, marketStatus: "Regular" })
        .mockResolvedValueOnce({ price: { toFixed: () => "200000000000000000000" }, marketStatus: "Regular" }) },
    };
    const meta = { getMany: vi.fn().mockResolvedValue({
      "0xa": { token: "0xa", symbol: "A", name: null, decimals: 18 },
      "0xb": { token: "0xb", symbol: "B", name: null, decimals: 18 },
    }) };
    const svc = new HoldingsService(prisma as never, meta as never, dummyChain as never, dummyRebVault as never);
    const r = await svc.getHoldings("0xv");
    const sum = r.holdings.reduce((s, h) => s + h.currentWeightBps, 0);
    expect(sum).toBeGreaterThanOrEqual(9999);
    expect(sum).toBeLessThanOrEqual(10001);
    const a = r.holdings.find((h) => h.symbol === "A")!;
    expect(a.currentWeightBps).toBe(3333);
    expect(a.driftBps).toBe(0);
    expect(a.valuePerUnitUsd).toBe("100000000000000000000");
  });

  it("rebalance vault: computes real current weights from held balances (skewed)", async () => {
    // Two equal PCF constituents (target 50/50) but held balances skewed (A=3e18, B=1e18).
    // Both priced at $100 (1e20 in 18-dec). A held value = 3e18 * 1e20 / 1e18 = 3e20.
    // B held value = 1e18 * 1e20 / 1e18 = 1e20. Total = 4e20.
    // currentWeightBps: A = 3e20 * 10000 / 4e20 = 7500, B = 2500.
    // targetWeightBps: A = 1e20 * 10000 / 2e20 = 5000, B = 5000.
    // driftBps: A = +2500, B = -2500.
    const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const VAULT = "0xcccccccccccccccccccccccccccccccccccccccc";

    const prisma = {
      basket: { findUnique: vi.fn().mockResolvedValue({
        vaultAddress: VAULT,
        vaultType: "Rebalance",
        constituents: [
          { token: TOKEN_A, unitQty: { toFixed: () => "1000000000000000000" } },
          { token: TOKEN_B, unitQty: { toFixed: () => "1000000000000000000" } },
        ],
      }) },
      navSnapshot: { findFirst: vi.fn().mockResolvedValue({ nav: { toFixed: () => "200000000000000000000" }, estimated: false, timestamp: new Date(1) }) },
      priceSnapshot: { findFirst: vi.fn()
        .mockResolvedValueOnce({ price: { toFixed: () => "100000000000000000000" }, marketStatus: "Regular" })
        .mockResolvedValueOnce({ price: { toFixed: () => "100000000000000000000" }, marketStatus: "Regular" }) },
    };
    const meta = { getMany: vi.fn().mockResolvedValue({
      [TOKEN_A]: { token: TOKEN_A, symbol: "AA", name: null, decimals: 18 },
      [TOKEN_B]: { token: TOKEN_B, symbol: "BB", name: null, decimals: 18 },
    }) };

    const rebVault = { heldTokens: vi.fn().mockResolvedValue([TOKEN_A, TOKEN_B]) };
    const chain = {
      publicClient: {
        multicall: vi.fn().mockResolvedValue([
          { status: "success", result: 3000000000000000000n }, // A: 3e18
          { status: "success", result: 1000000000000000000n }, // B: 1e18
        ]),
      },
    };

    const svc = new HoldingsService(prisma as never, meta as never, chain as never, rebVault as never);
    const r = await svc.getHoldings(VAULT);

    const a = r.holdings.find((h) => h.symbol === "AA")!;
    const b = r.holdings.find((h) => h.symbol === "BB")!;

    expect(a.currentWeightBps).toBe(7500);
    expect(b.currentWeightBps).toBe(2500);
    expect(a.targetWeightBps).toBe(5000);
    expect(b.targetWeightBps).toBe(5000);
    expect(a.driftBps).toBe(2500);
    expect(b.driftBps).toBe(-2500);

    const weightSum = r.holdings.reduce((s, h) => s + h.currentWeightBps, 0);
    expect(weightSum).toBeGreaterThanOrEqual(9999);
    expect(weightSum).toBeLessThanOrEqual(10001);
  });

  it("rebalance vault: falls back to current==target (drift 0) when heldTokens rejects", async () => {
    const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const VAULT = "0xcccccccccccccccccccccccccccccccccccccccc";

    const prisma = {
      basket: { findUnique: vi.fn().mockResolvedValue({
        vaultAddress: VAULT,
        vaultType: "Rebalance",
        constituents: [
          { token: TOKEN_A, unitQty: { toFixed: () => "1000000000000000000" } },
          { token: TOKEN_B, unitQty: { toFixed: () => "1000000000000000000" } },
        ],
      }) },
      navSnapshot: { findFirst: vi.fn().mockResolvedValue({ nav: { toFixed: () => "200000000000000000000" }, estimated: false, timestamp: new Date(1) }) },
      priceSnapshot: { findFirst: vi.fn()
        .mockResolvedValueOnce({ price: { toFixed: () => "100000000000000000000" }, marketStatus: "Regular" })
        .mockResolvedValueOnce({ price: { toFixed: () => "100000000000000000000" }, marketStatus: "Regular" }) },
    };
    const meta = { getMany: vi.fn().mockResolvedValue({
      [TOKEN_A]: { token: TOKEN_A, symbol: "AA", name: null, decimals: 18 },
      [TOKEN_B]: { token: TOKEN_B, symbol: "BB", name: null, decimals: 18 },
    }) };

    const rebVault = { heldTokens: vi.fn().mockRejectedValue(new Error("rpc error")) };
    const chain = { publicClient: { multicall: vi.fn() } };

    const svc = new HoldingsService(prisma as never, meta as never, chain as never, rebVault as never);

    // Should not throw.
    const r = await svc.getHoldings(VAULT);

    for (const h of r.holdings) {
      expect(h.driftBps).toBe(0);
      expect(h.currentWeightBps).toBe(h.targetWeightBps);
    }
  });
});
