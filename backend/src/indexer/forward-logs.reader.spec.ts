import { describe, it, expect, vi } from "vitest";
import { ViemChainLogReader } from "./indexer.service.js";

const QUEUE = "0xq";
const VAULT = "0xv";

function makeReader(logsByEvent: Record<string, unknown[]>, ticketCutoff = 9_999n) {
  const publicClient = {
    getLogs: vi.fn(({ event }: { event: { name: string } }) =>
      Promise.resolve(logsByEvent[event.name] ?? []),
    ),
    getBlock: vi.fn(() => Promise.resolve({ timestamp: 1_700n })),
    readContract: vi.fn(() =>
      // tickets(id) tuple: owner,isCreate,amount,cutoff,status
      Promise.resolve(["0xowner", true, 1_000_000n, ticketCutoff, 0]),
    ),
  };
  const chain = { publicClient } as never;
  const fwdReader = {
    abi: [],
    createRequestedEvent: { name: "CreateRequested" },
    redeemRequestedEvent: { name: "RedeemRequested" },
    cancelledEvent: { name: "Cancelled" },
    settledEvent: { name: "Settled" },
    partialFillEvent: { name: "PartialFill" },
  } as never;
  // Only getForwardQueueLogs is exercised; other ctor deps are unused stubs.
  return new ViemChainLogReader(chain, {} as never, {} as never, {} as never, {} as never, fwdReader, {} as never);
}

function log(name: string, args: Record<string, unknown>, logIndex = 0) {
  return {
    address: QUEUE,
    args,
    transactionHash: "0xhash",
    logIndex,
    blockNumber: 10n,
    eventName: name,
  };
}

describe("ViemChainLogReader.getForwardQueueLogs", () => {
  it("decodes CreateRequested -> CreateRequested event with amount/remaining/cutoff", async () => {
    const reader = makeReader({
      CreateRequested: [log("CreateRequested", { id: 0n, owner: "0xowner", cash: 1_000_000n, cutoff: 5_000n })],
    });
    const out = await reader.getForwardQueueLogs(QUEUE, VAULT, 0n, 20n);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("CreateRequested");
    expect(out[0]!.ticketId).toBe(0);
    expect(out[0]!.amount).toBe(1_000_000n);
    expect(out[0]!.remaining).toBe(1_000_000n);
    expect(out[0]!.cutoffMs).toBe(5_000_000); // 5000s -> ms
  });

  it("decodes PartialFill -> remaining=remainingCash, payload carries filled/remaining", async () => {
    const reader = makeReader({
      PartialFill: [log("PartialFill", { id: 2n, filledCash: 400_000n, remainingCash: 600_000n })],
    });
    const out = await reader.getForwardQueueLogs(QUEUE, VAULT, 0n, 20n);
    expect(out[0]!.kind).toBe("PartialFill");
    expect(out[0]!.remaining).toBe(600_000n);
    expect(out[0]!.payload).toEqual({ filledCash: "400000", remainingCash: "600000" });
    expect(out[0]!.cutoffMs).toBe(9_999_000); // refreshed cutoff read from tickets()
  });

  it("decodes Settled/Cancelled (id-only)", async () => {
    const reader = makeReader({
      Settled: [log("Settled", { id: 1n })],
      Cancelled: [log("Cancelled", { id: 1n }, 1)],
    });
    const out = await reader.getForwardQueueLogs(QUEUE, VAULT, 0n, 20n);
    const kinds = out.map((o) => o.kind).sort();
    expect(kinds).toEqual(["Cancelled", "Settled"]);
  });
});
