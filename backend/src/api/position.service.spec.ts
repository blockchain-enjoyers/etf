import { describe, expect, it, vi } from "vitest";
import { PositionService } from "./position.service.js";

describe("PositionService", () => {
  it("returns valued holdings, filters zero balances", async () => {
    const prisma = {
      basket: { findMany: vi.fn().mockResolvedValue([{ vaultAddress: "0xv1", symbol: "A" }, { vaultAddress: "0xv2", symbol: "B" }]) },
      navSnapshot: { findFirst: vi.fn().mockResolvedValue({ nav: { toFixed: () => "50000000000000000000" }, estimated: false }) },
    };
    const chain = { publicClient: { multicall: vi.fn().mockResolvedValue([
      { status: "success", result: 1000000000000000000n },
      { status: "success", result: 0n },
    ]) } };
    const svc = new PositionService(prisma as never, chain as never);
    const r = await svc.accountHoldings("0xo");
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0]!.vaultAddress).toBe("0xv1");
    expect(r.holdings[0]!.valueUsd).toBe("50000000000000000000");
    expect(r.holdings[0]!.symbol).toBe("A");
  });
});
