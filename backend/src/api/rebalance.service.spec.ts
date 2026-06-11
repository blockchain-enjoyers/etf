import { describe, it, expect, vi } from "vitest";
import { RebalanceService } from "./rebalance.service.js";

const WEEKDAY = "0xaa" as `0x${string}`;
const WEEKEND = "0xbb" as `0x${string}`;

function svc(overrides: {
  rebVault?: Record<string, unknown>;
  chain?: Record<string, unknown>;
  prisma?: Record<string, unknown>;
  registry?: Record<string, unknown>;
  rebModule?: Record<string, unknown>;
  signer?: Record<string, unknown>;
} = {}) {
  const repo = {
    getRebalanceHistory: vi.fn(async () => []),
    getKeeperPayouts: vi.fn(async () => []),
    getLatestPendingTarget: vi.fn(async () => null),
    getLastRebalanceAt: vi.fn(async () => null),
  };
  const rebVault = {
    heldTokens: vi.fn(async () => ["0xt"]),
    keeperBps: vi.fn(async () => 1000),
    totalSupply: vi.fn(async () => 0n),
    ...overrides.rebVault,
  };
  const keeper = { escrowOf: vi.fn(async () => 12n) };
  const chain = {
    publicClient: { readContract: vi.fn(async () => 5n), simulateContract: vi.fn(async () => ({ result: { price: 0n, safe: false } })) },
    account: undefined,
    ...overrides.chain,
  };
  const prisma = {
    basket: {
      findUnique: vi.fn(async () => ({
        vaultAddress: "0xv",
        constituents: [{ token: "0xt", unitQty: { toFixed: () => "1" } }],
      })),
    },
    ...overrides.prisma,
  };
  const registry = { address: () => undefined, ...overrides.registry };
  const rebModule = { triggerBandBps: async () => 0, ...overrides.rebModule };
  const signer = { payloadsFor: vi.fn(async () => [WEEKDAY, WEEKEND] as [`0x${string}`, `0x${string}`]), ...overrides.signer };
  return new RebalanceService(
    repo as never,
    rebVault as never,
    keeper as never,
    chain as never,
    prisma as never,
    registry as never,
    rebModule as never,
    signer as never,
  );
}

describe("RebalanceService", () => {
  it("builds rebalanceDetail with live held balances + null drift on no observations", async () => {
    const d = await svc().getRebalanceDetail("0xv");
    expect(d.heldTokens).toEqual([{ token: "0xt", balance: "5" }]);
    expect(d.drift).toBeNull();
    expect(d.target).toEqual([{ token: "0xt", unitQty: "1" }]);
    expect(d.totalSupply).toBe("0");
  });

  it("keeperStatus reads live escrow + DB payouts", async () => {
    const k = await svc().getKeeperStatus("0xv");
    expect(k.escrow).toBe("12");
    expect(k.keeperBps).toBe(1000);
  });

  it("computes signed drift + isDue when prices + held balances are skewed vs target", async () => {
    const TA = "0x000000000000000000000000000000000000000a" as `0x${string}`;
    const TB = "0x000000000000000000000000000000000000000b" as `0x${string}`;
    const price = 1_000_000_000_000_000_000n;

    const balances: Record<string, bigint> = {
      [TA.toLowerCase()]: 9n,
      [TB.toLowerCase()]: 1n,
    };

    const readContract = vi.fn(async (call: Record<string, unknown>) => {
      const fn = call.functionName as string;
      if (fn === "balanceOf") {
        const tokenAddr = (call.address as string).toLowerCase();
        return balances[tokenAddr] ?? 0n;
      }
      if (fn === "decimals") return 18;
      return 0n;
    });

    const simulateContract = vi.fn(async (call: Record<string, unknown>) => {
      const fn = call.functionName as string;
      if (fn === "priceOf") {
        // verify payloads from signer are passed through
        const args = call.args as [`0x${string}`, `0x${string}`[]];
        expect(args[1]).toEqual([WEEKDAY, WEEKEND]);
        return { result: { price, confLower: price, confUpper: price, marketStatus: 0, safe: true, timestamp: 0n } };
      }
      return { result: null };
    });

    const d = await svc({
      rebVault: {
        heldTokens: vi.fn(async () => [TA, TB]),
        totalSupply: vi.fn(async () => 10n),
      },
      chain: { publicClient: { readContract, simulateContract }, account: undefined },
      prisma: {
        basket: {
          findUnique: vi.fn(async () => ({
            vaultAddress: "0xv",
            constituents: [
              { token: TA, unitQty: { toFixed: () => "1" } },
              { token: TB, unitQty: { toFixed: () => "1" } },
            ],
          })),
        },
      },
      registry: { address: (cap: string) => (cap === "PriceAggregator" ? "0xagg" : undefined) },
      rebModule: { triggerBandBps: async () => 100 },
    }).getRebalanceDetail("0xv");

    expect(d.drift).not.toBeNull();
    expect(d.drift!.triggerBandBps).toBe(100);
    // Held A weight = 9/10 = 9000bps, target A = 5000bps → +4000 drift; B = -4000.
    const a = d.drift!.items.find((i) => i.token === TA)!;
    const b = d.drift!.items.find((i) => i.token === TB)!;
    expect(a.driftBps).toBe(4000);
    expect(b.driftBps).toBe(-4000);
    expect(d.drift!.isDue).toBe(true);
  });

  it("normalizes mixed-decimal tokens to true USD value when computing drift", async () => {
    const TA = "0x000000000000000000000000000000000000000a" as `0x${string}`;
    const TB = "0x000000000000000000000000000000000000000b" as `0x${string}`;
    const price = 1_000_000_000_000_000_000n;

    const decimalsByToken: Record<string, number> = {
      [TA.toLowerCase()]: 18,
      [TB.toLowerCase()]: 6,
    };
    const balances: Record<string, bigint> = {
      [TA.toLowerCase()]: 1_000_000_000_000_000_000n,
      [TB.toLowerCase()]: 3_000_000n,
    };

    const readContract = vi.fn(async (call: Record<string, unknown>) => {
      const fn = call.functionName as string;
      const tokenAddr = (call.address as string).toLowerCase();
      if (fn === "balanceOf") return balances[tokenAddr] ?? 0n;
      if (fn === "decimals") {
        const arg = ((call.args as string[] | undefined)?.[0] ?? call.address) as string;
        return decimalsByToken[arg.toLowerCase()] ?? 18;
      }
      return 0n;
    });

    const simulateContract = vi.fn(async () => ({
      result: { price, confLower: price, confUpper: price, marketStatus: 0, safe: true, timestamp: 0n },
    }));

    const d = await svc({
      rebVault: {
        heldTokens: vi.fn(async () => [TA, TB]),
        totalSupply: vi.fn(async () => 10n),
      },
      chain: { publicClient: { readContract, simulateContract }, account: undefined },
      prisma: {
        basket: {
          findUnique: vi.fn(async () => ({
            vaultAddress: "0xv",
            constituents: [
              { token: TA, unitQty: { toFixed: () => "1000000000000000000" } },
              { token: TB, unitQty: { toFixed: () => "1000000" } },
            ],
          })),
        },
      },
      registry: { address: (cap: string) => (cap === "PriceAggregator" ? "0xagg" : undefined) },
      rebModule: { triggerBandBps: async () => 100 },
    }).getRebalanceDetail("0xv");

    expect(d.drift).not.toBeNull();
    const a = d.drift!.items.find((i) => i.token === TA)!;
    const b = d.drift!.items.find((i) => i.token === TB)!;
    // Normalized: A USD weight 2500bps vs target 5000 → -2500; B 7500 vs 5000 → +2500.
    expect(a.driftBps).toBe(-2500);
    expect(b.driftBps).toBe(2500);
    expect(d.drift!.isDue).toBe(true);
  });

  it("returns null drift when signer throws (no price snapshot)", async () => {
    const TA = "0x000000000000000000000000000000000000000a" as `0x${string}`;
    const readContract = vi.fn(async (call: Record<string, unknown>) => {
      const fn = call.functionName as string;
      if (fn === "balanceOf") return 5n;
      if (fn === "decimals") return 18;
      return 0n;
    });

    const d = await svc({
      rebVault: { heldTokens: vi.fn(async () => [TA]), totalSupply: vi.fn(async () => 5n) },
      chain: { publicClient: { readContract, simulateContract: vi.fn() }, account: undefined },
      prisma: {
        basket: {
          findUnique: vi.fn(async () => ({
            vaultAddress: "0xv",
            constituents: [{ token: TA, unitQty: { toFixed: () => "1" } }],
          })),
        },
      },
      registry: { address: (cap: string) => (cap === "PriceAggregator" ? "0xagg" : undefined) },
      signer: { payloadsFor: vi.fn(async () => { throw new Error("payload-signer: no price snapshot for 0xa"); }) },
    }).getRebalanceDetail("0xv");

    expect(d.drift).toBeNull();
  });
});
