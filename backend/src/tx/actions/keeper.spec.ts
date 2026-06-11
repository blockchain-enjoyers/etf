import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData } from "viem";
import { BasketNavObserverAbi, ForwardCashQueueAbi } from "@meridian/contracts";
import { buildKeeperRecord, buildKeeperSettle } from "./keeper.js";

const VAULT = "0x000000000000000000000000000000000000aa01";
const TOKEN_A = "0x000000000000000000000000000000000000aaaa" as `0x${string}`;
const OBSERVER = "0x00000000000000000000000000000000000000b0" as `0x${string}`;
const QUEUE = "0x00000000000000000000000000000000000000ff" as `0x${string}`;
const AP = "0x0000000000000000000000000000000000000a00";

// Fixed signed payload bytes returned by the mock signer — two per token (weekday, weekend).
const PAYLOAD_WD = "0xaa01" as `0x${string}`;
const PAYLOAD_WE = "0xaa02" as `0x${string}`;

function makeSigner() {
  return { payloadsFor: vi.fn(async (_token: string) => [PAYLOAD_WD, PAYLOAD_WE] as const) };
}

function makeDeps(opts: { addr?: `0x${string}` | undefined; held?: `0x${string}`[] } = {}) {
  const held = opts.held ?? [TOKEN_A];
  return {
    registry: { address: vi.fn().mockReturnValue("addr" in opts ? opts.addr : OBSERVER) },
    rebVault: { heldTokens: vi.fn().mockResolvedValue(held) },
    signer: makeSigner(),
  };
}

describe("buildKeeperRecord", () => {
  it("encodes record(vault, held, signerPayloads) targeting the observer", async () => {
    const deps = makeDeps({ addr: OBSERVER });

    const result = await buildKeeperRecord(deps, VAULT);

    expect(deps.rebVault.heldTokens).toHaveBeenCalledWith(VAULT);
    expect(deps.signer.payloadsFor).toHaveBeenCalledWith(TOKEN_A);
    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(OBSERVER);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);

    const expected = encodeFunctionData({
      abi: BasketNavObserverAbi,
      functionName: "record",
      args: [VAULT as `0x${string}`, [TOKEN_A], [[PAYLOAD_WD, PAYLOAD_WE]]],
    });
    expect(call.data).toBe(expected);
  });

  it("throws not-deployed when BasketNavObserver is unregistered", async () => {
    const deps = makeDeps({ addr: undefined });
    await expect(buildKeeperRecord(deps, VAULT)).rejects.toThrow(/not-deployed/);
  });
});

describe("buildKeeperSettle", () => {
  it("encodes settle(ids.map(BigInt), held, signerPayloads, ap) targeting the queue", async () => {
    const deps = makeDeps({ addr: QUEUE });
    const ticketIds = [1, 2];

    const result = await buildKeeperSettle(deps, VAULT, { ticketIds, ap: AP });

    expect(deps.rebVault.heldTokens).toHaveBeenCalledWith(VAULT);
    expect(deps.signer.payloadsFor).toHaveBeenCalledWith(TOKEN_A);
    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(QUEUE);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);

    const expected = encodeFunctionData({
      abi: ForwardCashQueueAbi,
      functionName: "settle",
      args: [[1n, 2n], [TOKEN_A], [[PAYLOAD_WD, PAYLOAD_WE]], AP as `0x${string}`],
    });
    expect(call.data).toBe(expected);
  });

  it("throws not-deployed when ForwardCashQueue is unregistered", async () => {
    const deps = makeDeps({ addr: undefined });
    await expect(buildKeeperSettle(deps, VAULT, { ticketIds: [1], ap: AP })).rejects.toThrow(/not-deployed/);
  });
});
