import { describe, it, expect, vi } from "vitest";
import { ForwardService } from "./forward.service.js";

function decimal(v: string) {
  return { toFixed: () => v } as never;
}

function makeService(opts: {
  tickets?: unknown[];
  queue?: string;
  maxCreateFlowBps?: bigint;
  supply?: bigint;
} = {}) {
  const repo = {
    getForwardTickets: vi.fn(async () => opts.tickets ?? []),
    getPendingForwardTickets: vi.fn(async () =>
      (opts.tickets ?? []).filter((t) => {
        const s = (t as { status: string }).status;
        return s === "Pending" || s === "Partial";
      }),
    ),
    getForwardHistory: vi.fn(async () => []),
  };
  const forwardQueues = { queueFor: vi.fn(() => opts.queue) };
  const forward = {
    maxCreateFlowBps: vi.fn(async () => opts.maxCreateFlowBps ?? 0n),
  };
  const rebVault = { totalSupply: vi.fn(async () => opts.supply ?? 0n) };
  return new ForwardService(
    repo as never, forwardQueues as never, forward as never, rebVault as never,
    {} as never, {} as never, {} as never,
  );
}

const createTicket = {
  ticketId: 0, vaultAddress: "0xv", owner: "0xo", kind: "Create",
  amount: decimal("1000000"), remaining: decimal("1000000"), status: "Pending",
  cutoff: new Date(5000), createdAt: new Date(0),
};

describe("ForwardService.getTickets", () => {
  it("maps a Create ticket to the wire DTO (lowercased kind/status)", async () => {
    const svc = makeService({ tickets: [createTicket] });
    const out = await svc.getTickets("0xv");
    expect(out[0]).toEqual({
      id: 0, vaultAddress: "0xv", owner: "0xo", kind: "create",
      amountRaw: "1000000", remainingRaw: "1000000", status: "pending",
      cutoffMs: 5000, createdAtMs: 0,
    });
  });
});

describe("ForwardService.getQueue", () => {
  it("uncapped queue => null windowCapShares, pendingCreateCash = sum of pending create remaining", async () => {
    const svc = makeService({ tickets: [createTicket], queue: "0xq", maxCreateFlowBps: 0n, supply: 100n });
    const out = await svc.getQueue("0xv");
    expect(out.queueAddress).toBe("0xq");
    expect(out.capacity.maxCreateFlowBps).toBe(0);
    expect(out.capacity.windowCapShares).toBeNull();
    expect(out.capacity.pendingCreateCash).toBe("1000000");
    expect(out.capacity.pendingRedeemShares).toBe("0");
  });

  it("capped queue => windowCapShares = supply*bps/BPS (exact), pending sums exact", async () => {
    const svc = makeService({
      tickets: [
        { ...createTicket, remaining: decimal("400") },
        { ...createTicket, kind: "Redeem", remaining: decimal("700"), status: "Partial" },
      ],
      queue: "0xq", maxCreateFlowBps: 500n, supply: 100_000n, // cap = 100000*500/10000 = 5000
    });
    const out = await svc.getQueue("0xv");
    expect(out.capacity.windowCapShares).toBe("5000");
    expect(out.capacity.pendingCreateCash).toBe("400");
    expect(out.capacity.pendingRedeemShares).toBe("700");
  });

  it("no deployed queue => queueAddress null, uncapped capacity, empty tickets", async () => {
    const svc = makeService({ queue: undefined });
    const out = await svc.getQueue("0xv");
    expect(out.queueAddress).toBeNull();
    expect(out.tickets).toEqual([]);
    expect(out.capacity).toEqual({
      maxCreateFlowBps: 0, windowCapShares: null, pendingCreateCash: "0", pendingRedeemShares: "0",
    });
  });
});

describe("ForwardService.getHistory", () => {
  it("maps event rows to wire items", async () => {
    const svc = makeService();
    svc["repo"].getForwardHistory = vi.fn(async () => [
      { kind: "Settled", ticketId: 3, txHash: "0xh", timestamp: new Date(6), payload: {} },
    ]) as never;
    const out = await svc.getHistory("0xv");
    expect(out.items[0]).toEqual({ kind: "Settled", id: 3, txHash: "0xh", timestampMs: 6, payload: {} });
  });
});
