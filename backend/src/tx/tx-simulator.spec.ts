import { describe, expect, it, vi } from "vitest";
import { TxSimulator } from "./tx-simulator.js";

describe("TxSimulator", () => {
  it("marks simulated true on success, false on revert; never throws", async () => {
    const okChain = { publicClient: { call: vi.fn().mockResolvedValue({}) } };
    const badChain = { publicClient: { call: vi.fn().mockRejectedValue(new Error("revert")) } };
    expect(await new TxSimulator(okChain as never).simulate({ to: "0x1", data: "0x", value: "0" } as never, "0xo")).toBe(true);
    expect(await new TxSimulator(badChain as never).simulate({ to: "0x1", data: "0x", value: "0" } as never, "0xo")).toBe(false);
  });
});
