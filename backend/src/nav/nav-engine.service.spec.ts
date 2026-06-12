import { describe, expect, it, vi } from "vitest";
import { MarketStatus } from "../domain/market-status.js";
import { OracleSource } from "../domain/oracle.js";
import type { NavReading, SignalRouter } from "../signals/signal-router.js";
import { BootstrapBasket } from "./basket-source.js";
import { ConfidenceService } from "./confidence.service.js";
import { NavEngineService } from "./nav-engine.service.js";

const A1 = "0x00000000000000000000000000000000000000a1";
const A2 = "0x00000000000000000000000000000000000000a2";
const BOOT = "0x0000000000000000000000000000000000000000000000000000000000000001";

// A SignalRouter stub that returns a per-token reading from a map.
function routerOf(byToken: Record<string, NavReading>): SignalRouter {
  return { getReading: async (t: string) => byToken[t] } as unknown as SignalRouter;
}

function reading(over: Partial<NavReading>): NavReading {
  return {
    price: 100_000_000_000_000_000_000n, // 100.0
    confidence: 0n,
    timestamp: 1_750_000_000,
    marketStatus: MarketStatus.Regular,
    source: OracleSource.Chainlink,
    estimated: false,
    ...over,
  };
}

const offchainConfig = { get: (k: string) => (k === "NAV_SOURCE" ? "offchain" : undefined) };

function engine(router: SignalRouter): NavEngineService {
  // ESTIMATED_BAND_BPS = 200; off-chain signal path is the only path at L1.
  return new NavEngineService(
    router,
    new ConfidenceService(200),
    new BootstrapBasket(),
    {} as never,
    {} as never,
    {} as never,
    offchainConfig as never,
    {} as never,
  );
}

describe("NavEngineService.computeNav (scenario matrix, off-chain)", () => {
  it("OPEN: all-Regular → nav = Σ holdingᵢ·priceᵢ, estimated=false, Regular", async () => {
    // holdings: A1 10.0 @ 100 = 1000 ; A2 5.0 @ 200 = 1000 ; nav = 2000
    const router = routerOf({
      [A1]: reading({ price: 100_000_000_000_000_000_000n }),
      [A2]: reading({ price: 200_000_000_000_000_000_000n }),
    });
    const res = await engine(router).computeNav(BOOT);
    expect(res.nav).toBe(2_000_000_000_000_000_000_000n);
    expect(res.estimated).toBe(false);
    expect(res.marketStatus).toBe(MarketStatus.Regular);
    expect(res.source).toBe(OracleSource.Chainlink);
    expect(res.confidenceLower).toBe(2_000_000_000_000_000_000_000n);
    expect(res.confidenceUpper).toBe(2_000_000_000_000_000_000_000n);
  });

  it("WEEKEND-STALE: any Closed constituent → estimated=true, status Closed, band widened", async () => {
    const router = routerOf({
      [A1]: reading({ price: 100_000_000_000_000_000_000n }),
      [A2]: reading({
        price: 200_000_000_000_000_000_000n,
        marketStatus: MarketStatus.Closed,
        estimated: true,
      }),
    });
    const res = await engine(router).computeNav(BOOT);
    expect(res.estimated).toBe(true);
    expect(res.marketStatus).toBe(MarketStatus.Closed);
    // +2% of 2000 = 40 → [1960, 2040]
    expect(res.confidenceLower).toBe(1_960_000_000_000_000_000_000n);
    expect(res.confidenceUpper).toBe(2_040_000_000_000_000_000_000n);
  });

  it("HALT: an Unknown constituent → estimated=true, status Unknown (never settlement)", async () => {
    const router = routerOf({
      [A1]: reading({ price: 100_000_000_000_000_000_000n }),
      [A2]: reading({
        price: 200_000_000_000_000_000_000n,
        marketStatus: MarketStatus.Unknown,
        estimated: true,
      }),
    });
    const res = await engine(router).computeNav(BOOT);
    expect(res.estimated).toBe(true);
    expect(res.marketStatus).toBe(MarketStatus.Unknown);
  });

  it("SEQUENCER-DOWN: router returns a synthesized LastClose reading → estimated=true", async () => {
    const router = routerOf({
      [A1]: reading({ price: 0n, marketStatus: MarketStatus.Unknown, source: OracleSource.LastClose, estimated: true }),
      [A2]: reading({ price: 0n, marketStatus: MarketStatus.Unknown, source: OracleSource.LastClose, estimated: true }),
    });
    const res = await engine(router).computeNav(BOOT);
    expect(res.estimated).toBe(true);
    expect(res.source).toBe(OracleSource.LastClose);
    expect(res.nav).toBe(0n);
  });

  it("aggregates confidence: Σ holdingᵢ·confidenceᵢ folds into the band when not estimated", async () => {
    // A1: conf 1.0 over 10 held = 10 ; A2: conf 2.0 over 5 held = 10 ; band = 20
    const router = routerOf({
      [A1]: reading({ price: 100_000_000_000_000_000_000n, confidence: 1_000_000_000_000_000_000n }),
      [A2]: reading({ price: 200_000_000_000_000_000_000n, confidence: 2_000_000_000_000_000_000n }),
    });
    const res = await engine(router).computeNav(BOOT);
    expect(res.nav).toBe(2_000_000_000_000_000_000_000n);
    expect(res.confidenceLower).toBe(1_980_000_000_000_000_000_000n);
    expect(res.confidenceUpper).toBe(2_020_000_000_000_000_000_000n);
  });
});

describe("NavEngineService.computeNav (on-chain path)", () => {
  const onchainConfig = { get: (k: string) => (k === "NAV_SOURCE" ? "onchain" : undefined) };

  it("onchain mode: Basket vault uses L4 per-unit NAV scaled by outstanding units", async () => {
    const onchain = {
      readL4PerUnit: vi.fn().mockResolvedValue({ nav: 42n, confidenceLower: 40n, confidenceUpper: 44n, estimated: false }),
      readL4Holdings: vi.fn(),
    };
    const prisma = {
      basket: {
        findUnique: vi.fn().mockResolvedValue({
          vaultType: "Basket",
          unitSize: { toString: () => "1000000000000000000" },
          constituents: [{ token: A1, unitQty: { toString: () => "5" } }],
        }),
      },
    };
    const registry = { present: () => true };
    const chain = { publicClient: { readContract: vi.fn().mockResolvedValue(2_000_000_000_000_000_000n) } };
    const svc = new NavEngineService(
      {} as never, {} as never, {} as never,
      onchain as never, prisma as never, registry as never, onchainConfig as never, chain as never,
    );
    const r = await svc.computeNav("0xVault");
    expect(onchain.readL4PerUnit).toHaveBeenCalledWith("0xVault", {
      tokens: [A1],
      unitQty: [5n],
      unitSize: 1_000_000_000_000_000_000n,
    });
    // totalSupply 2e18 / unitSize 1e18 = 2 units → per-unit 42 scales to 84
    expect(r.nav).toBe(84n);
  });

  it("routes a Rebalance vault to readL4Holdings", async () => {
    const onchain = {
      readL4PerUnit: vi.fn(),
      readL4Holdings: vi.fn().mockResolvedValue({ nav: 7n } as never),
    };
    const prisma = {
      basket: {
        findUnique: vi.fn().mockResolvedValue({
          vaultAddress: "0xreb",
          vaultType: "Rebalance",
          constituents: [],
          unitSize: { toString: () => "1000" },
        }),
      },
    };
    const registry = { present: vi.fn(() => true) };
    const config = { get: vi.fn((k: string) => (k === "NAV_SOURCE" ? "onchain" : undefined)) };
    const svc = new NavEngineService(
      {} as never, {} as never, {} as never,
      onchain as never, prisma as never, registry as never, config as never, {} as never,
    );
    const r = await svc.computeNav("0xreb");
    expect(onchain.readL4Holdings).toHaveBeenCalledWith("0xreb");
    expect(r.nav).toBe(7n);
  });

  it("routes a Registry vault to readL4Holdings (Merkle recipe → navOf would RecipeMismatch)", async () => {
    const onchain = {
      readL4PerUnit: vi.fn(),
      readL4Holdings: vi.fn().mockResolvedValue({ nav: 9n } as never),
    };
    const prisma = {
      basket: {
        findUnique: vi.fn().mockResolvedValue({
          vaultAddress: "0xreg",
          vaultType: "Registry",
          constituents: [],
          unitSize: { toString: () => "1000" },
        }),
      },
    };
    const registry = { present: vi.fn(() => true) };
    const config = { get: vi.fn((k: string) => (k === "NAV_SOURCE" ? "onchain" : undefined)) };
    const svc = new NavEngineService(
      {} as never, {} as never, {} as never,
      onchain as never, prisma as never, registry as never, config as never, {} as never,
    );
    const r = await svc.computeNav("0xreg");
    expect(onchain.readL4Holdings).toHaveBeenCalledWith("0xreg");
    expect(r.nav).toBe(9n);
  });
});
