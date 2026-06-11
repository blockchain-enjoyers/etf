import { describe, it, expect, vi } from "vitest";
import { ForwardService } from "./forward.service.js";
import { encodeErrorResult } from "viem";
import { ForwardCashQueueAbi } from "@meridian/contracts";

function revertWith(errorName: string) {
  const data = encodeErrorResult({ abi: ForwardCashQueueAbi, errorName } as never);
  const err = new Error(errorName) as Error & { data?: string };
  err.data = data;
  return err;
}

function makeService(opts: {
  queue?: string;
  gate?: { ok: true; navPerShare: bigint } | { ok: false; err: Error };
  twap?: bigint;
}) {
  const repo = {} as never;
  const forwardQueues = { queueFor: vi.fn(() => opts.queue) };
  const rebVault = { heldTokens: vi.fn(async () => ["0xt1"]), totalSupply: vi.fn(async () => 1n) };
  const forward = {} as never;
  const chain = {
    publicClient: {
      readContract: vi.fn(async () => {
        if (opts.gate && "ok" in opts.gate && opts.gate.ok) return opts.gate.navPerShare;
        throw (opts.gate as { err: Error }).err;
      }),
    },
  };
  const observer = { consult: vi.fn(async () => ({ twap: opts.twap ?? 0n, count: 5n })) };
  const aggSourcePayloads = { payloadsFor: vi.fn(async () => [[]]) };
  return new ForwardService(
    repo, forwardQueues as never, forward, rebVault as never,
    chain as never, observer as never, aggSourcePayloads as never,
  );
}

describe("ForwardService.getGateStatus", () => {
  it("no deployed queue => all guards unavailable, open false, estimated true", async () => {
    const svc = makeService({ queue: undefined });
    const out = await svc.getGateStatus("0xv");
    expect(out.open).toBe(false);
    expect(out.estimated).toBe(true);
    expect(out.guards.every((g) => !g.ok)).toBe(true);
    expect(out.navPerShare).toBeNull();
  });

  it("gate view succeeds => open true, all guards ok, navPerShare set", async () => {
    const svc = makeService({ queue: "0xq", gate: { ok: true, navPerShare: 1_050_000_000_000_000_000n }, twap: 1_000_000_000_000_000_000n });
    const out = await svc.getGateStatus("0xv");
    expect(out.open).toBe(true);
    expect(out.guards.every((g) => g.ok)).toBe(true);
    expect(out.navPerShare).toBe("1050000000000000000");
    expect(out.twap).toBe("1000000000000000000");
  });

  it("NotOpen revert => g2 blocked with reason 'NotOpen', other guards ok", async () => {
    const svc = makeService({ queue: "0xq", gate: { ok: false, err: revertWith("NotOpen") } });
    const out = await svc.getGateStatus("0xv");
    expect(out.open).toBe(false);
    const g2 = out.guards.find((g) => g.id === "g2")!;
    expect(g2.ok).toBe(false);
    expect(g2.reason).toBe("NotOpen");
    expect(out.guards.find((g) => g.id === "g0")!.ok).toBe(true);
  });

  it("unknown revert => never throws, all guards unavailable", async () => {
    const svc = makeService({ queue: "0xq", gate: { ok: false, err: new Error("boom") } });
    const out = await svc.getGateStatus("0xv");
    expect(out.open).toBe(false);
    expect(out.guards.every((g) => g.reason === "unavailable")).toBe(true);
  });
});
