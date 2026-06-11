import { describe, it, expect, vi } from "vitest";
import { ManagedRebalanceVaultReader } from "./managed-rebalance-vault.reader.js";

function readerWith(map: Record<string, unknown>) {
  const publicClient = {
    readContract: vi.fn(({ functionName }: { functionName: string }) =>
      Promise.resolve(map[functionName]),
    ),
  };
  return new ManagedRebalanceVaultReader({ publicClient } as never);
}

describe("ManagedRebalanceVaultReader", () => {
  it("reads heldTokens / totalSupply / keeperBps / keeperEscrow / targetEffectiveAt", async () => {
    const r = readerWith({
      heldTokens: ["0xa", "0xb"],
      totalSupply: 1_000_000n,
      keeperBps: 1000n,
      keeperEscrow: "0xkeeper",
      targetEffectiveAt: 1717000000n,
    });
    expect(await r.heldTokens("0xv")).toEqual(["0xa", "0xb"]);
    expect(await r.totalSupply("0xv")).toBe(1_000_000n);
    expect(await r.keeperBps("0xv")).toBe(1000);
    expect(await r.keeperEscrow("0xv")).toBe("0xkeeper");
    expect(await r.targetEffectiveAt("0xv")).toBe(1717000000n);
  });
});
