import { describe, expect, it } from "vitest";
import { DexTwapAdapter, type DexTwapReader } from "./dex-twap.adapter.js";

function fakeReader(over: Partial<{ twap: bigint; liquidity: bigint; updatedAt: number }> = {}): DexTwapReader {
  return {
    async readTwap() {
      return { twap: over.twap ?? 100_000000000000000000n, liquidity: over.liquidity ?? 10n ** 24n, updatedAt: over.updatedAt ?? 1_700_000_000 };
    },
  };
}

describe("DexTwapAdapter", () => {
  it("returns a DexTwap reading at canonical 18-dec", async () => {
    const a = new DexTwapAdapter(fakeReader(), { minLiquidity: 10n ** 18n });
    const r = await a.read("0xtoken");
    expect(r.source).toBe("DexTwap");
    expect(r.price).toBe(100_000000000000000000n);
    expect(r.marketStatus).toBe("Regular");
  });

  it("marks thin-pool reads as Closed (degrade) when liquidity below floor", async () => {
    const a = new DexTwapAdapter(fakeReader({ liquidity: 1n }), { minLiquidity: 10n ** 18n });
    const r = await a.read("0xtoken");
    expect(r.marketStatus).toBe("Closed");
  });

  it("exposes a stable name/source", () => {
    const a = new DexTwapAdapter(fakeReader(), { minLiquidity: 10n ** 18n });
    expect(a.source).toBe("DexTwap");
  });
});
