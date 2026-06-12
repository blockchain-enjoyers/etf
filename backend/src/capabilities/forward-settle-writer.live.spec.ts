import { describe, it, expect, vi } from "vitest";
import { LiveForwardSettleWriter } from "./forward-settle-writer.live.adapter.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";

const T1 = "0x1111111111111111111111111111111111111111";
const T2 = "0x2222222222222222222222222222222222222222";
const VAULT_A = "0x000000000000000000000000000000000000aa01";
const VAULT_B = "0x000000000000000000000000000000000000aa02";
const QUEUE_A = "0x00000000000000000000000000000000000000f1";
const QUEUE_B = "0x00000000000000000000000000000000000000f2";

const PAYLOAD_WD = "0xaa01" as `0x${string}`;
const PAYLOAD_WE = "0xaa02" as `0x${string}`;

function makeSigner() {
  return { payloadsFor: vi.fn(async (_token: string) => [PAYLOAD_WD, PAYLOAD_WE] as const) };
}

// vault -> its own ForwardCashQueue; an unmapped vault resolves to undefined (dormant).
const QUEUE_BY_VAULT: Record<string, string> = {
  [VAULT_A.toLowerCase()]: QUEUE_A,
  [VAULT_B.toLowerCase()]: QUEUE_B,
};

function writer(opts: { mapped?: boolean; held?: string[] } = {}) {
  const mapped = opts.mapped ?? true;
  const writeContract = vi.fn(async (req: { address: string }) => req.address);
  const forwardQueues = {
    queueFor: vi.fn((vault: string) => (mapped ? QUEUE_BY_VAULT[vault.toLowerCase()] : undefined)),
  };
  const rebVault = { heldTokens: vi.fn(async () => opts.held ?? [T1]) };
  const chain = { walletClient: { writeContract }, chain: {}, account: { address: "0xop" } };
  const signer = makeSigner();
  return {
    w: new LiveForwardSettleWriter(chain as never, forwardQueues as never, rebVault as never, signer as never),
    signer,
    writeContract,
  };
}

describe("LiveForwardSettleWriter", () => {
  it("throws CapabilityUnavailableError when the vault has no queue", async () => {
    const { w } = writer({ mapped: false });
    await expect(w.settle(VAULT_A as `0x${string}`, [1n], "0xap")).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
  });

  it("settles to the vault's own queue with held tokens + signer payloads", async () => {
    const { w, signer, writeContract } = writer({ held: [T1, T2] });
    const tx = await w.settle(VAULT_A as `0x${string}`, [3n], "0xap");
    expect(tx).toBe(QUEUE_A);
    expect(writeContract.mock.calls[0]![0].address).toBe(QUEUE_A);
    expect(signer.payloadsFor).toHaveBeenCalledWith(T1);
    expect(signer.payloadsFor).toHaveBeenCalledWith(T2);
  });

  it("routes a different vault to a DISTINCT queue (per-vault routing)", async () => {
    const { w, writeContract } = writer();
    await w.settle(VAULT_A as `0x${string}`, [1n], "0xap");
    await w.settle(VAULT_B as `0x${string}`, [1n], "0xap");
    expect(writeContract.mock.calls[0]![0].address).toBe(QUEUE_A);
    expect(writeContract.mock.calls[1]![0].address).toBe(QUEUE_B);
  });

  it("approve throws CapabilityUnavailableError (testnet approvals are pre-seeded out-of-band)", async () => {
    const { w } = writer();
    await expect(w.approve(VAULT_A as `0x${string}`, "0xap")).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
  });
});
