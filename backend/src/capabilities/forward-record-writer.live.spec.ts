import { describe, it, expect, vi } from "vitest";
import { LiveForwardRecordWriter } from "./forward-record-writer.live.adapter.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";

const T1 = "0x1111111111111111111111111111111111111111";
const VAULT_A = "0x000000000000000000000000000000000000aa01";
const VAULT_B = "0x000000000000000000000000000000000000aa02";
const QUEUE_A = "0x00000000000000000000000000000000000000f1";
const QUEUE_B = "0x00000000000000000000000000000000000000f2";
const OBSERVER_A = "0x00000000000000000000000000000000000000a1";
const OBSERVER_B = "0x00000000000000000000000000000000000000b1";

const PAYLOAD_WD = "0xaa01" as `0x${string}`;
const PAYLOAD_WE = "0xaa02" as `0x${string}`;

function makeSigner() {
  return { payloadsFor: vi.fn(async (_token: string) => [PAYLOAD_WD, PAYLOAD_WE] as const) };
}

const QUEUE_BY_VAULT: Record<string, string> = {
  [VAULT_A.toLowerCase()]: QUEUE_A,
  [VAULT_B.toLowerCase()]: QUEUE_B,
};
const OBSERVER_BY_QUEUE: Record<string, string> = {
  [QUEUE_A]: OBSERVER_A,
  [QUEUE_B]: OBSERVER_B,
};

function writer(opts: { mapped?: boolean } = {}) {
  const mapped = opts.mapped ?? true;
  const writeContract = vi.fn(async (req: { address: string }) => req.address);
  const forwardQueues = {
    queueFor: vi.fn((vault: string) => (mapped ? QUEUE_BY_VAULT[vault.toLowerCase()] : undefined)),
  };
  const queueReader = { observer: vi.fn(async (q: string) => OBSERVER_BY_QUEUE[q]) };
  const rebVault = { heldTokens: vi.fn(async () => [T1]) };
  const chain = { walletClient: { writeContract }, chain: {}, account: { address: "0xop" } };
  const signer = makeSigner();
  return {
    w: new LiveForwardRecordWriter(
      chain as never,
      forwardQueues as never,
      queueReader as never,
      rebVault as never,
      signer as never,
    ),
    writeContract,
  };
}

describe("LiveForwardRecordWriter", () => {
  it("throws CapabilityUnavailableError when the vault has no queue", async () => {
    const { w } = writer({ mapped: false });
    await expect(w.record(VAULT_A as `0x${string}`)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("records into the vault's own observer (read off its queue)", async () => {
    const { w, writeContract } = writer();
    const tx = await w.record(VAULT_A as `0x${string}`);
    expect(tx).toBe(OBSERVER_A);
    expect(writeContract.mock.calls[0]![0].address).toBe(OBSERVER_A);
  });

  it("records into a DISTINCT observer for a different vault (per-vault routing)", async () => {
    const { w, writeContract } = writer();
    await w.record(VAULT_A as `0x${string}`);
    await w.record(VAULT_B as `0x${string}`);
    expect(writeContract.mock.calls[0]![0].address).toBe(OBSERVER_A);
    expect(writeContract.mock.calls[1]![0].address).toBe(OBSERVER_B);
  });
});
