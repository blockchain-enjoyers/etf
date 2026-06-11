import { describe, expect, it, vi } from "vitest";
import { TokenMetadataService } from "./token-metadata.service.js";

function make(over: Partial<{ cached: unknown[]; reads: unknown[] }> = {}) {
  const prisma = {
    tokenMetadata: {
      findMany: vi.fn().mockResolvedValue(over.cached ?? []),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
  };
  const chain = { publicClient: { multicall: vi.fn().mockResolvedValue(over.reads ?? []) } };
  return { svc: new TokenMetadataService(prisma as never, chain as never), prisma, chain };
}

describe("TokenMetadataService", () => {
  it("returns cached metadata without hitting the chain", async () => {
    const { svc, chain } = make({ cached: [{ token: "0xa", symbol: "TSLA", name: "Tesla", decimals: 18 }] });
    const r = await svc.getMany(["0xA"]);
    expect(r["0xa"]!.symbol).toBe("TSLA");
    expect(chain.publicClient.multicall).not.toHaveBeenCalled();
  });

  it("reads + upserts on cache miss", async () => {
    const { svc, prisma } = make({
      cached: [],
      reads: [{ status: "success", result: "AMZN" }, { status: "success", result: "Amazon" }, { status: "success", result: 18 }],
    });
    const r = await svc.getMany(["0xB"]);
    expect(r["0xb"]!.symbol).toBe("AMZN");
    expect(prisma.tokenMetadata.upsert).toHaveBeenCalledOnce();
  });
});
