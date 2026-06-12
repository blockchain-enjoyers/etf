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

  it("rebalance vault: uses holdingsOf values when vault supports it (skewed 75/25)", async () => {
    // Two equal PCF constituents (target 50/50) but holdingsOf returns A=3e18, B=1e18.
    // Both priced at $100 (1e20 in 18-dec). currentWeightBps: A=7500, B=2500. driftBps: A=+2500, B=-2500.
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
    // First multicall: holdingsOf succeeds for both.
    const chain = {
      publicClient: {
        multicall: vi.fn().mockResolvedValueOnce([
          { status: "success", result: 3000000000000000000n }, // holdingsOf A: 3e18
          { status: "success", result: 1000000000000000000n }, // holdingsOf B: 1e18
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

    // Exactly one multicall (holdingsOf only — no fallback needed).
    expect(chain.publicClient.multicall).toHaveBeenCalledTimes(1);
  });

  it("rebalance vault: falls back to balanceOf when holdingsOf reverts (pre-seam deployment)", async () => {
    // holdingsOf reverts for both tokens → second multicall returns balanceOf values.
    // The results must be identical to the all-success case above (holdingsOf == balanceOf for live types).
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
        multicall: vi.fn()
          // First call: holdingsOf reverts for both (pre-seam vault).
          .mockResolvedValueOnce([
            { status: "failure", error: new Error("revert") },
            { status: "failure", error: new Error("revert") },
          ])
          // Second call: balanceOf fallback — skewed 3/1 same as the holdingsOf test.
          .mockResolvedValueOnce([
            { status: "success", result: 3000000000000000000n },
            { status: "success", result: 1000000000000000000n },
          ]),
      },
    };

    const svc = new HoldingsService(prisma as never, meta as never, chain as never, rebVault as never);
    const r = await svc.getHoldings(VAULT);

    // Must NOT throw; must produce identical weight output to the holdingsOf success case.
    const a = r.holdings.find((h) => h.symbol === "AA")!;
    const b = r.holdings.find((h) => h.symbol === "BB")!;
    expect(a.currentWeightBps).toBe(7500);
    expect(b.currentWeightBps).toBe(2500);
    expect(a.driftBps).toBe(2500);
    expect(b.driftBps).toBe(-2500);

    // Two multicalls: holdingsOf (failed) + balanceOf fallback.
    expect(chain.publicClient.multicall).toHaveBeenCalledTimes(2);
  });

  it("rebalance vault: mixed — holdingsOf succeeds for A, fails for B → B falls back to balanceOf", async () => {
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
        multicall: vi.fn()
          // First call: holdingsOf succeeds for A (3e18), fails for B.
          .mockResolvedValueOnce([
            { status: "success", result: 3000000000000000000n },
            { status: "failure", error: new Error("revert") },
          ])
          // Second call: balanceOf fallback only for B (index 1 only).
          .mockResolvedValueOnce([
            { status: "success", result: 1000000000000000000n },
          ]),
      },
    };

    const svc = new HoldingsService(prisma as never, meta as never, chain as never, rebVault as never);
    const r = await svc.getHoldings(VAULT);

    // A from holdingsOf (3e18), B from balanceOf fallback (1e18) → same 75/25 split.
    const a = r.holdings.find((h) => h.symbol === "AA")!;
    const b = r.holdings.find((h) => h.symbol === "BB")!;
    expect(a.currentWeightBps).toBe(7500);
    expect(b.currentWeightBps).toBe(2500);

    // Two multicalls: holdingsOf (partial failure) + balanceOf fallback for B only.
    expect(chain.publicClient.multicall).toHaveBeenCalledTimes(2);
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
