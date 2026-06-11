import { describe, expect, it } from "vitest";
import { PerpMarkAdapter, type PerpMarkReader } from "./perp-mark.adapter.js";

function fakeReader(over: Partial<{ mark: bigint; fundingStale: boolean; updatedAt: number }> = {}): PerpMarkReader {
  return {
    async readMark() {
      return { mark: over.mark ?? 200_000000000000000000n, fundingStale: over.fundingStale ?? false, updatedAt: over.updatedAt ?? 1_700_000_000 };
    },
  };
}

describe("PerpMarkAdapter", () => {
  it("returns a PerpMark reading at canonical 18-dec", async () => {
    const a = new PerpMarkAdapter(fakeReader());
    const r = await a.read("0xtoken");
    expect(r.source).toBe("PerpMark");
    expect(r.price).toBe(200_000000000000000000n);
    expect(r.marketStatus).toBe("Overnight");
  });

  it("degrades to Closed when funding is stale", async () => {
    const a = new PerpMarkAdapter(fakeReader({ fundingStale: true }));
    const r = await a.read("0xtoken");
    expect(r.marketStatus).toBe("Closed");
  });
});
