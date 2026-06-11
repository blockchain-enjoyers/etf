import { describe, it, expect, vi } from "vitest";
import { RebalanceModuleReader } from "./rebalance-module.reader.js";

function readerWith(addr: `0x${string}` | undefined, map: Record<string, unknown>) {
  const publicClient = {
    readContract: vi.fn(({ functionName }: { functionName: string }) =>
      Promise.resolve(map[functionName]),
    ),
  };
  const registry = { address: vi.fn(() => addr) };
  return new RebalanceModuleReader({ publicClient } as never, registry as never);
}

describe("RebalanceModuleReader", () => {
  it("reads triggerBandBps when address is set", async () => {
    const r = readerWith("0xmod", { triggerBandBps: 250n });
    expect(r.address).toBe("0xmod");
    expect(await r.triggerBandBps()).toBe(250);
  });

  it("returns 0 when address is undefined", async () => {
    const r = readerWith(undefined, { triggerBandBps: 250n });
    expect(r.address).toBeUndefined();
    expect(await r.triggerBandBps()).toBe(0);
  });
});
