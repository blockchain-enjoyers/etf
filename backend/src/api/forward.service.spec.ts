import { describe, it, expect, vi } from "vitest";
import { Logger } from "@nestjs/common";
import { ForwardService } from "./forward.service.js";

function decimal(v: string) {
  return { toFixed: () => v } as never;
}

type Reverts = "isRegistry" | "stable" | "flatCreateFee" | "flatRedeemFee" | "feeToken";

function makeService(opts: {
  tickets?: unknown[];
  queue?: string;
  maxCreateFlowBps?: bigint;
  supply?: bigint;
  observerByQueue?: Record<string, `0x${string}`>;
  consult?: (observer?: `0x${string}`) => { twap: bigint; count: bigint };
  isRegistry?: boolean;
  stable?: `0x${string}`;
  flatCreateFee?: bigint;
  flatRedeemFee?: bigint;
  feeToken?: `0x${string}`;
  reverts?: Reverts[];
} = {}) {
  const reverts = new Set(opts.reverts ?? []);
  const boom = (name: Reverts) => {
    if (reverts.has(name)) throw new Error(`${name} reverted`);
  };
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
    observer: vi.fn(async (q: string) => (opts.observerByQueue ?? {})[q]),
    isRegistry: vi.fn(async () => {
      boom("isRegistry");
      return opts.isRegistry ?? false;
    }),
    stable: vi.fn(async () => {
      boom("stable");
      return opts.stable ?? "0x000000000000000000000000000000000000feee";
    }),
  };
  const rebVault = {
    totalSupply: vi.fn(async () => opts.supply ?? 0n),
    flatCreateFee: vi.fn(async () => {
      boom("flatCreateFee");
      return opts.flatCreateFee ?? 0n;
    }),
    flatRedeemFee: vi.fn(async () => {
      boom("flatRedeemFee");
      return opts.flatRedeemFee ?? 0n;
    }),
    feeToken: vi.fn(async () => {
      boom("feeToken");
      return opts.feeToken ?? "0x000000000000000000000000000000000000feee";
    }),
  };
  const observer = {
    consult: vi.fn(async (_v: `0x${string}`, _w: bigint, obs?: `0x${string}`) =>
      opts.consult ? opts.consult(obs) : { twap: 0n, count: 0n },
    ),
  };
  const svc = new ForwardService(
    repo as never, forwardQueues as never, forward as never, rebVault as never,
    {} as never, observer as never, {} as never,
  );
  return Object.assign(svc, { __mocks: { forwardQueues, forward, observer } });
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

describe("ForwardService.readTwap (per-vault observer)", () => {
  const QUEUE = "0x00000000000000000000000000000000000000f1";
  const OBSERVER = "0x00000000000000000000000000000000000000a1" as `0x${string}`;

  it("resolves the observer off the vault's own queue and consults THAT observer", async () => {
    const svc = makeService({
      queue: QUEUE,
      observerByQueue: { [QUEUE]: OBSERVER },
      consult: (obs) => (obs === OBSERVER ? { twap: 123n, count: 2n } : { twap: 0n, count: 0n }),
    });
    const out = await (svc as unknown as { readTwap: (v: `0x${string}`) => Promise<string | null> }).readTwap("0xv");
    const mocks = (svc as unknown as { __mocks: { forward: { observer: ReturnType<typeof vi.fn> }; observer: { consult: ReturnType<typeof vi.fn> } } }).__mocks;
    expect(mocks.forward.observer).toHaveBeenCalledWith(QUEUE);
    expect(mocks.observer.consult).toHaveBeenCalledWith("0xv", 86_400n, OBSERVER);
    expect(out).toBe("123");
  });

  it("returns null when the vault has no queue (no singleton fallback)", async () => {
    const svc = makeService({ queue: undefined });
    const out = await (svc as unknown as { readTwap: (v: `0x${string}`) => Promise<string | null> }).readTwap("0xv");
    const mocks = (svc as unknown as { __mocks: { observer: { consult: ReturnType<typeof vi.fn> } } }).__mocks;
    expect(out).toBeNull();
    expect(mocks.observer.consult).not.toHaveBeenCalled();
  });

  it("returns null when the window is sparse (count 0)", async () => {
    const svc = makeService({
      queue: QUEUE,
      observerByQueue: { [QUEUE]: OBSERVER },
      consult: () => ({ twap: 0n, count: 0n }),
    });
    const out = await (svc as unknown as { readTwap: (v: `0x${string}`) => Promise<string | null> }).readTwap("0xv");
    expect(out).toBeNull();
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

describe("ForwardService.getQueue registry fees", () => {
  const USDG = "0x000000000000000000000000000000000000feee" as `0x${string}`;

  it("registry queue => fees disclose isRegistry + the flat USDG create/redeem fees", async () => {
    const svc = makeService({
      queue: "0xq",
      isRegistry: true,
      flatCreateFee: 5_000_000n,
      flatRedeemFee: 3_000_000n,
      feeToken: USDG,
      stable: USDG,
    });
    const out = await svc.getQueue("0xv");
    expect(out.fees).toEqual({
      isRegistry: true,
      feeToken: USDG,
      feeDecimals: 18, // chain mock has no readContract → decimals read fails → 18 default
      flatCreateFee: "5000000",
      flatRedeemFee: "3000000",
    });
  });

  it("managed (non-registry) queue => fees is null", async () => {
    const svc = makeService({ queue: "0xq", isRegistry: false });
    const out = await svc.getQueue("0xv");
    expect(out.fees).toBeNull();
  });

  it("no deployed queue => fees is null (no reads attempted)", async () => {
    const svc = makeService({ queue: undefined });
    const out = await svc.getQueue("0xv");
    expect(out.fees).toBeNull();
  });

  it("reverting fee reads on a registry queue => resilient: fees with 0s, no throw", async () => {
    const svc = makeService({
      queue: "0xq",
      isRegistry: true,
      reverts: ["flatCreateFee", "flatRedeemFee", "feeToken"],
    });
    const out = await svc.getQueue("0xv");
    expect(out.fees).toEqual({
      isRegistry: true,
      feeToken: "0x0000000000000000000000000000000000000000",
      feeDecimals: 18,
      flatCreateFee: "0",
      flatRedeemFee: "0",
    });
  });

  it("reverting isRegistry => resilient: fees null, no throw", async () => {
    const svc = makeService({ queue: "0xq", reverts: ["isRegistry"] });
    const out = await svc.getQueue("0xv");
    expect(out.fees).toBeNull();
  });

  it("stable != feeToken => warns but still returns fees (never throws)", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined as never);
    const svc = makeService({
      queue: "0xq",
      isRegistry: true,
      flatCreateFee: 5_000_000n,
      flatRedeemFee: 3_000_000n,
      feeToken: USDG,
      stable: "0x00000000000000000000000000000000000000ff",
    });
    const out = await svc.getQueue("0xv");
    expect(out.fees?.isRegistry).toBe(true);
    expect(out.fees?.feeToken).toBe(USDG);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("unreadable stable() => skips the cross-check, keeps disclosed fees", async () => {
    const svc = makeService({
      queue: "0xq",
      isRegistry: true,
      flatCreateFee: 5_000_000n,
      flatRedeemFee: 3_000_000n,
      feeToken: USDG,
      reverts: ["stable"],
    });
    const out = await svc.getQueue("0xv");
    expect(out.fees).toEqual({
      isRegistry: true,
      feeToken: USDG,
      feeDecimals: 18, // chain mock has no readContract → decimals read fails → 18 default
      flatCreateFee: "5000000",
      flatRedeemFee: "3000000",
    });
  });
});
