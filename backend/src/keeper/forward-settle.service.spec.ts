import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForwardSettleService } from "./forward-settle.service.js";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";

function svc(opts: {
  enabled?: boolean;
  wallet?: boolean;
  ap?: string;
  pending?: { id: number; cutoffMs: number }[];
  writerThrows?: Error;
}) {
  const config = {
    get: (k: string) => {
      if (k === "FORWARD_OPERATOR_ENABLED") return opts.enabled ?? true;
      if (k === "FORWARD_AP_FILLER_ADDRESS") return "ap" in opts ? opts.ap : "0xap";
      return undefined;
    },
  };
  const chain = { walletClient: opts.wallet === false ? undefined : {} };
  const repo = {
    getPendingForwardTickets: vi.fn(async () =>
      (opts.pending ?? []).map((p) => ({ ticketId: p.id, cutoff: new Date(p.cutoffMs) })),
    ),
  };
  const forwardQueues = { pairs: () => [{ vault: "0xv", queue: "0xq" }], refresh: vi.fn(async () => {}) };
  const writer = {
    settle: vi.fn(async () => {
      if (opts.writerThrows) throw opts.writerThrows;
      return "0xtx" as const;
    }),
  };
  const ap = { prepare: vi.fn(async () => ({ status: "noop" as const })) };
  return {
    service: new ForwardSettleService(
      config as never,
      chain as never,
      repo as never,
      forwardQueues as never,
      writer as never,
      ap as never,
    ),
    writer,
    ap,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("ForwardSettleService", () => {
  it("noop when FORWARD_OPERATOR_ENABLED is false", async () => {
    const { service, writer } = svc({ enabled: false });
    expect((await service.run()).status).toBe("noop");
    expect(writer.settle).not.toHaveBeenCalled();
  });

  it("noop when no walletClient", async () => {
    const { service } = svc({ wallet: false });
    expect((await service.run()).status).toBe("noop");
  });

  it("noop when no AP filler configured", async () => {
    const { service } = svc({ ap: undefined });
    expect((await service.run()).status).toBe("noop");
  });

  it("skips when no past-cutoff tickets", async () => {
    const { service, writer } = svc({ pending: [{ id: 0, cutoffMs: Date.now() + 100000 }] });
    expect((await service.run()).status).toBe("skipped");
    expect(writer.settle).not.toHaveBeenCalled();
  });

  it("settles the past-cutoff ids for the vault with the AP filler", async () => {
    const { service, writer } = svc({ pending: [{ id: 3, cutoffMs: Date.now() - 1000 }] });
    const res = await service.run();
    expect(res.status).toBe("submitted");
    expect(writer.settle).toHaveBeenCalledWith("0xv", [3n], "0xap");
  });

  it("prepares the AP (funds+approves) before settling", async () => {
    const { service, writer, ap } = svc({ pending: [{ id: 5, cutoffMs: Date.now() - 1000 }] });
    await service.run();
    expect(ap.prepare).toHaveBeenCalledWith("0xv", [5n]);
    expect(ap.prepare.mock.invocationCallOrder[0]!).toBeLessThan(writer.settle.mock.invocationCallOrder[0]!);
  });

  it("capability-absent (writer throws CapabilityUnavailableError) => noop", async () => {
    const { service } = svc({
      pending: [{ id: 1, cutoffMs: Date.now() - 1000 }],
      writerThrows: new CapabilityUnavailableError("ForwardCashQueue"),
    });
    expect((await service.run()).status).toBe("noop");
  });

  it("had past-cutoff tickets but settle reverted => failed (not a misleading 'skipped')", async () => {
    const { service } = svc({
      pending: [{ id: 1, cutoffMs: Date.now() - 1000 }],
      writerThrows: new Error("NotSafe()"),
    });
    const res = await service.run();
    expect(res.status).toBe("failed");
    expect(res.detail).toContain("NotSafe");
  });
});
