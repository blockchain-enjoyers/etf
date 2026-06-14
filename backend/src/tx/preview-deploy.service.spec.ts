import { describe, it, expect, vi } from "vitest";
import { demoTokens } from "@meridian/contracts";
import { PreviewDeployService } from "./preview-deploy.service.js";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);

const USDG = "0x000000000000000000000000000000000000feed";

function makeService(over: {
  price?: Record<string, string>;
  simulate?: () => Promise<{ result: unknown }>;
  // Per-TYPE creation fee by enum index; absent ⇒ getters revert (pre-fee factory) ⇒ no creationFee.
  feeByIndex?: Record<number, bigint>;
  feeToken?: string;
} = {}) {
  const price = over.price ?? { [A]: "100000000000000000000", [B]: "200000000000000000000" }; // $100, $200 (18-dec)
  const readContract = over.feeByIndex
    ? vi.fn(async (raw: unknown) => {
        const a = raw as { functionName: string; args?: unknown[] };
        if (a.functionName === "creationFeeToken") return over.feeToken ?? USDG;
        if (a.functionName === "creationFee") return over.feeByIndex![Number(a.args?.[0])] ?? 0n;
        throw new Error(`unexpected read ${a.functionName}`);
      })
    : vi.fn(async () => {
        throw new Error("revert: function does not exist");
      });
  const chain = {
    publicClient: {
      simulateContract: over.simulate ?? vi.fn(async () => ({ result: "0xVault" })),
      readContract,
    },
  };
  const prisma = {
    priceSnapshot: {
      findFirst: vi.fn(async ({ where }: { where: { token: string } }) => {
        const p = price[where.token] ?? price[where.token.toLowerCase()];
        return p ? { price: { toFixed: () => p } } : null;
      }),
    },
  };
  const meta = { getMany: vi.fn(async () => ({
    [A.toLowerCase()]: { symbol: "AAA", decimals: 18 },
    [B.toLowerCase()]: { symbol: "BBB", decimals: 18 },
    [USDG.toLowerCase()]: { symbol: "USDG", decimals: 18 },
  })) };
  const registry = { address: vi.fn(() => "0xFactory") };
  return new PreviewDeployService(chain as never, prisma as never, meta as never, registry as never);
}

describe("PreviewDeployService", () => {
  it("quantities: parses qty to 18-dec base units, prices informationally", async () => {
    const svc = makeService();
    const out = await svc.preview({
      account: "0xo", vaultKind: "basket", name: "X", symbol: "X",
      tokens: [A], unitSize: "1000", composition: { mode: "quantities", qty: ["50"] },
    });
    expect(out.unitQty).toEqual(["50000000000000000000"]);
    expect(out.predictedVault).toBe("0xVault");
    expect(out.gate.gated).toBe(false);
  });

  it("registry: simulates createRegistryIndex and returns the predicted vault", async () => {
    const simulate = vi.fn(async () => ({ result: "0xRegistryVault" }));
    const svc = makeService({ simulate });
    const out = await svc.preview({
      account: "0xo", vaultKind: "registry", name: "Reg", symbol: "REG",
      tokens: [A, B], unitSize: "1000",
      composition: { mode: "quantities", qty: ["2", "3"] },
      manager: "0xo", managerFeeBps: 0, keeperBps: 0,
    });
    expect(out.predictedVault).toBe("0xRegistryVault");
    expect(out.gate.gated).toBe(false);
    // Confirms the registry branch routed to createRegistryIndex (not a flat createX).
    const args = (simulate.mock.calls[0] as unknown[])[0] as { functionName: string };
    expect(args.functionName).toBe("createRegistryIndex");
  });

  it("weights: derives qty = value/price (40% of $1000 at $100 = 4 tokens)", async () => {
    const svc = makeService();
    const out = await svc.preview({
      account: "0xo", vaultKind: "rebalance", name: "X", symbol: "X",
      tokens: [A, B], unitSize: "1000",
      composition: { mode: "weights", weightsBps: [4000, 6000], valuePerUnitUsd: "1000" },
    });
    // 40% * $1000 / $100 = 4 ; 60% * $1000 / $200 = 3
    expect(out.unitQty).toEqual(["4000000000000000000", "3000000000000000000"]);
    expect(out.gate.gated).toBe(false);
  });

  it("weights: a missing price gates with price-missing", async () => {
    const svc = makeService({ price: { [A]: "100000000000000000000" } }); // B has no price
    const out = await svc.preview({
      account: "0xo", vaultKind: "rebalance", name: "X", symbol: "X",
      tokens: [A, B], unitSize: "1000",
      composition: { mode: "weights", weightsBps: [4000, 6000], valuePerUnitUsd: "1000" },
    });
    expect(out.priceMissing).toContain(B);
    expect(out.gate).toEqual({ gated: true, reason: "price-missing" });
    expect(out.predictedVault).toBeNull();
  });

  it("weights: prices a demo-catalog token from the catalog baseline when it has no snapshot", async () => {
    const demo = demoTokens[0]!;
    const svc = makeService({ price: {} }); // no PriceSnapshot rows at all
    const out = await svc.preview({
      account: "0xo", vaultKind: "rebalance", name: "X", symbol: "X",
      tokens: [demo.address], unitSize: "1000",
      composition: { mode: "weights", weightsBps: [10000], valuePerUnitUsd: "1000" },
    });
    expect(out.priceMissing).toEqual([]);
    expect(out.gate.gated).toBe(false);
    expect(BigInt(out.unitQty[0]!)).toBeGreaterThan(0n);
  });

  it("gates with length-mismatch when composition length != tokens length (does not throw)", async () => {
    const svc = makeService();
    const out = await svc.preview({
      account: "0xo", vaultKind: "basket", name: "X", symbol: "X",
      tokens: [A, B], unitSize: "1000", composition: { mode: "quantities", qty: ["50"] },
    });
    expect(out.gate.gated).toBe(true);
    expect(out.gate.reason).toBe("length-mismatch");
    expect(out.unitQty).toEqual([]);
    expect(out.predictedVault).toBeNull();
  });

  it("predictedVault null + gated when simulate reverts", async () => {
    const svc = makeService({ simulate: vi.fn(async () => { throw new Error("NotWhitelisted"); }) });
    const out = await svc.preview({
      account: "0xo", vaultKind: "rebalance", name: "X", symbol: "X",
      tokens: [A], unitSize: "1000", composition: { mode: "weights", weightsBps: [10000], valuePerUnitUsd: "1000" },
    });
    expect(out.predictedVault).toBeNull();
    expect(out.gate.gated).toBe(true);
  });

  it("omits creationFee when the per-TYPE fee getter reverts (pre-fee factory)", async () => {
    const svc = makeService();
    const out = await svc.preview({
      account: "0xo", vaultKind: "managed", name: "X", symbol: "X",
      tokens: [A], unitSize: "1000", composition: { mode: "quantities", qty: ["1"] },
      manager: "0xo", managerFeeBps: 50,
    });
    expect(out.creationFee).toBeUndefined();
  });

  it("returns creationFee for a managed deploy (reads enum index 2; valueUsd scaled to 18-dec USD)", async () => {
    const FEE = 1_000_000_000_000_000_000n; // 1 USDG @ 18-dec
    const svc = makeService({ feeByIndex: { 2: FEE } });
    const out = await svc.preview({
      account: "0xo", vaultKind: "managed", name: "X", symbol: "X",
      tokens: [A], unitSize: "1000", composition: { mode: "quantities", qty: ["1"] },
      manager: "0xo", managerFeeBps: 50,
    });
    expect(out.creationFee).toBeDefined();
    expect(out.creationFee!.token).toBe(USDG);
    expect(out.creationFee!.symbol).toBe("USDG");
    expect(out.creationFee!.amount).toBe(FEE.toString());
    expect(out.creationFee!.valueUsd).toBe("1000000000000000000");
  });
});
