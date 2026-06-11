import { describe, it, expect, vi } from "vitest";
import { ForwardCashQueueReader } from "./forward-cash-queue.reader.js";

function readerWith(map: Record<string, unknown>) {
  const publicClient = {
    readContract: vi.fn(({ functionName }: { functionName: string }) =>
      Promise.resolve(map[functionName]),
    ),
  };
  return new ForwardCashQueueReader({ publicClient } as never);
}

describe("ForwardCashQueueReader", () => {
  it("reads ticketCount / vault / maxCreateFlowBps / spreadBps / cutoffDelay", async () => {
    const r = readerWith({
      ticketCount: 3n,
      vault: "0xvault",
      maxCreateFlowBps: 500n,
      spreadBps: 50,
      cutoffDelay: 3600n,
    });
    expect(await r.ticketCount("0xq")).toBe(3n);
    expect(await r.vault("0xq")).toBe("0xvault");
    expect(await r.maxCreateFlowBps("0xq")).toBe(500n);
    expect(await r.spreadBps("0xq")).toBe(50);
    expect(await r.cutoffDelay("0xq")).toBe(3600n);
  });

  it("exposes the five queue events for the indexer", () => {
    const r = readerWith({});
    expect(r.createRequestedEvent.name).toBe("CreateRequested");
    expect(r.redeemRequestedEvent.name).toBe("RedeemRequested");
    expect(r.cancelledEvent.name).toBe("Cancelled");
    expect(r.settledEvent.name).toBe("Settled");
    expect(r.partialFillEvent.name).toBe("PartialFill");
  });
});
