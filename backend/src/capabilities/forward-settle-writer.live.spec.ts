import { describe, it, expect, vi } from "vitest";
import { LiveForwardSettleWriter } from "./forward-settle-writer.live.adapter.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";

const T1 = "0x1111111111111111111111111111111111111111";
const T2 = "0x2222222222222222222222222222222222222222";

const PAYLOAD_WD = "0xaa01" as `0x${string}`;
const PAYLOAD_WE = "0xaa02" as `0x${string}`;

function makeSigner() {
  return { payloadsFor: vi.fn(async (_token: string) => [PAYLOAD_WD, PAYLOAD_WE] as const) };
}

function writer(opts: { queue?: string; held?: string[]; tx?: string }) {
  const registry = { address: (c: string) => (c === "ForwardCashQueue" ? opts.queue : undefined) };
  const rebVault = { heldTokens: vi.fn(async () => opts.held ?? [T1]) };
  const chain = {
    walletClient: { writeContract: vi.fn(async () => opts.tx ?? "0xtx") },
    chain: {},
    account: { address: "0xop" },
  };
  const signer = makeSigner();
  return { w: new LiveForwardSettleWriter(chain as never, registry as never, rebVault as never, signer as never), signer };
}

describe("LiveForwardSettleWriter", () => {
  it("throws CapabilityUnavailableError when the queue is absent", async () => {
    const { w } = writer({ queue: undefined });
    await expect(w.settle("0xv", [1n], "0xap")).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("settles with held tokens + signer payloads when the queue is present", async () => {
    const { w, signer } = writer({ queue: "0xqueue", held: [T1, T2], tx: "0xhash" });
    const tx = await w.settle("0xv", [3n], "0xap");
    expect(tx).toBe("0xhash");
    expect(signer.payloadsFor).toHaveBeenCalledWith(T1);
    expect(signer.payloadsFor).toHaveBeenCalledWith(T2);
  });

  it("approve throws CapabilityUnavailableError (testnet approvals are pre-seeded out-of-band)", async () => {
    const { w } = writer({ queue: "0xqueue" });
    await expect(w.approve("0xv", "0xap")).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });
});
