import { describe, it, expect, vi } from "vitest";
import { PreviewDeployService } from "./preview-deploy.service.js";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);

function makeService(over: { price?: Record<string, string>; simulate?: () => Promise<{ result: unknown }> } = {}) {
  const price = over.price ?? { [A]: "100000000000000000000", [B]: "200000000000000000000" }; // $100, $200 (18-dec)
  const chain = {
    publicClient: {
      simulateContract: over.simulate ?? vi.fn(async () => ({ result: "0xVault" })),
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
  const meta = { getMany: vi.fn(async () => ({ [A.toLowerCase()]: { symbol: "AAA", decimals: 18 }, [B.toLowerCase()]: { symbol: "BBB", decimals: 18 } })) };
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
});
