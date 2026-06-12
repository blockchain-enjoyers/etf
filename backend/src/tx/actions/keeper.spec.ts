import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData } from "viem";
import { BasketNavObserverAbi, ForwardCashQueueAbi } from "@meridian/contracts";
import { buildKeeperRecord, buildKeeperSettle } from "./keeper.js";

const VAULT_A = "0x000000000000000000000000000000000000aa01";
const VAULT_B = "0x000000000000000000000000000000000000aa02";
const TOKEN_A = "0x000000000000000000000000000000000000aaaa" as `0x${string}`;
const OBSERVER_A = "0x00000000000000000000000000000000000000a1" as `0x${string}`;
const OBSERVER_B = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const QUEUE_A = "0x00000000000000000000000000000000000000f1" as `0x${string}`;
const QUEUE_B = "0x00000000000000000000000000000000000000f2" as `0x${string}`;
const AP = "0x0000000000000000000000000000000000000a00";

// Fixed signed payload bytes returned by the mock signer — two per token (weekday, weekend).
const PAYLOAD_WD = "0xaa01" as `0x${string}`;
const PAYLOAD_WE = "0xaa02" as `0x${string}`;

function makeSigner() {
  return { payloadsFor: vi.fn(async (_token: string) => [PAYLOAD_WD, PAYLOAD_WE] as const) };
}

// Per-vault forward routing fixture: vault -> its own queue, and queue -> its own observer.
const QUEUE_BY_VAULT: Record<string, `0x${string}`> = {
  [VAULT_A.toLowerCase()]: QUEUE_A,
  [VAULT_B.toLowerCase()]: QUEUE_B,
};
const OBSERVER_BY_QUEUE: Record<string, `0x${string}`> = {
  [QUEUE_A]: OBSERVER_A,
  [QUEUE_B]: OBSERVER_B,
};

function makeDeps(opts: { mapped?: boolean; held?: `0x${string}`[] } = {}) {
  const held = opts.held ?? [TOKEN_A];
  const mapped = opts.mapped ?? true;
  return {
    forwardQueues: {
      queueFor: vi.fn((vault: string) => (mapped ? QUEUE_BY_VAULT[vault.toLowerCase()] : undefined)),
    },
    queueReader: {
      observer: vi.fn(async (queue: `0x${string}`) => OBSERVER_BY_QUEUE[queue]!),
    },
    rebVault: { heldTokens: vi.fn().mockResolvedValue(held) },
    signer: makeSigner(),
  };
}

describe("buildKeeperRecord", () => {
  it("encodes record(vault, held, signerPayloads) targeting the vault's own observer", async () => {
    const deps = makeDeps();

    const result = await buildKeeperRecord(deps, VAULT_A);

    expect(deps.forwardQueues.queueFor).toHaveBeenCalledWith(VAULT_A);
    expect(deps.queueReader.observer).toHaveBeenCalledWith(QUEUE_A);
    expect(deps.rebVault.heldTokens).toHaveBeenCalledWith(VAULT_A);
    expect(deps.signer.payloadsFor).toHaveBeenCalledWith(TOKEN_A);
    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(OBSERVER_A);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);

    const expected = encodeFunctionData({
      abi: BasketNavObserverAbi,
      functionName: "record",
      args: [VAULT_A as `0x${string}`, [TOKEN_A], [[PAYLOAD_WD, PAYLOAD_WE]]],
    });
    expect(call.data).toBe(expected);
  });

  it("records into a DISTINCT observer for a different vault (per-vault routing)", async () => {
    const deps = makeDeps();

    const a = await buildKeeperRecord(deps, VAULT_A);
    const b = await buildKeeperRecord(deps, VAULT_B);

    const toA = (a.steps[0] as { to: string }).to;
    const toB = (b.steps[0] as { to: string }).to;
    expect(toA).toBe(OBSERVER_A);
    expect(toB).toBe(OBSERVER_B);
    expect(toA).not.toBe(toB);
  });

  it("throws not-deployed when the vault has no forward queue", async () => {
    const deps = makeDeps({ mapped: false });
    await expect(buildKeeperRecord(deps, VAULT_A)).rejects.toThrow(/not-deployed: no forward queue for this vault/);
  });
});

describe("buildKeeperSettle", () => {
  it("encodes settle(ids.map(BigInt), held, signerPayloads, ap) targeting the vault's own queue", async () => {
    const deps = makeDeps();
    const ticketIds = [1, 2];

    const result = await buildKeeperSettle(deps, VAULT_A, { ticketIds, ap: AP });

    expect(deps.forwardQueues.queueFor).toHaveBeenCalledWith(VAULT_A);
    expect(deps.rebVault.heldTokens).toHaveBeenCalledWith(VAULT_A);
    expect(deps.signer.payloadsFor).toHaveBeenCalledWith(TOKEN_A);
    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(QUEUE_A);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);

    const expected = encodeFunctionData({
      abi: ForwardCashQueueAbi,
      functionName: "settle",
      args: [[1n, 2n], [TOKEN_A], [[PAYLOAD_WD, PAYLOAD_WE]], AP as `0x${string}`],
    });
    expect(call.data).toBe(expected);
  });

  it("settles into a DISTINCT queue for a different vault (per-vault routing)", async () => {
    const deps = makeDeps();

    const a = await buildKeeperSettle(deps, VAULT_A, { ticketIds: [1], ap: AP });
    const b = await buildKeeperSettle(deps, VAULT_B, { ticketIds: [1], ap: AP });

    const toA = (a.steps[0] as { to: string }).to;
    const toB = (b.steps[0] as { to: string }).to;
    expect(toA).toBe(QUEUE_A);
    expect(toB).toBe(QUEUE_B);
    expect(toA).not.toBe(toB);
  });

  it("throws not-deployed when the vault has no forward queue", async () => {
    const deps = makeDeps({ mapped: false });
    await expect(buildKeeperSettle(deps, VAULT_A, { ticketIds: [1], ap: AP })).rejects.toThrow(
      /not-deployed: no forward queue for this vault/,
    );
  });
});
