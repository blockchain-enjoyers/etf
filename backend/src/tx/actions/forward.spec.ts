import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData } from "viem";
import { ForwardCashQueueAbi } from "@meridian/contracts";
import { buildForwardCancel, buildForwardCreate, buildForwardRedeem } from "./forward.js";

const VAULT = "0x000000000000000000000000000000000000aa01";
const ACCOUNT = "0x0000000000000000000000000000000000000001";
const QUEUE = "0x00000000000000000000000000000000000000ff";
const CASH = "0x000000000000000000000000000000000000cccc";

const BASKET = { vaultAddress: VAULT, symbol: "IDX", cashToken: CASH };

function makeDeps(opts: {
  basket?: unknown;
  allowances?: bigint[];
  queue?: string | undefined;
}) {
  const allowances = opts.allowances ?? [0n];
  // Per-vault binding: resolve THIS vault's queue (mirrors ForwardQueueRegistry.queueFor), so a
  // ticket can never be routed into the chain singleton or another vault's queue.
  const bound = "queue" in opts ? opts.queue : QUEUE;
  return {
    prisma: {
      basket: { findUnique: vi.fn().mockResolvedValue("basket" in opts ? opts.basket : BASKET) },
    },
    publicClient: {
      multicall: vi.fn().mockResolvedValue(allowances.map((a) => ({ status: "success", result: a }))),
    },
    meta: {
      getMany: vi.fn().mockResolvedValue({
        [CASH.toLowerCase()]: { symbol: "USDC", decimals: 6 },
        [VAULT.toLowerCase()]: { symbol: "IDX", decimals: 18 },
      }),
    },
    forwardQueues: { queueFor: vi.fn((v: string) => (v.toLowerCase() === VAULT.toLowerCase() ? bound : undefined)) },
  };
}

describe("buildForwardCreate", () => {
  it("emits approve(cashToken→queue) then call requestCreate(cash) targeting the queue", async () => {
    const deps = makeDeps({ allowances: [0n] });
    const cash = "1000000"; // 1 USDC (6-dec)

    const result = await buildForwardCreate(deps, VAULT, { account: ACCOUNT, cash });

    expect(result.steps).toHaveLength(2);

    const approve = result.steps[0] as { kind: string; to: string; contractName: string };
    expect(approve.kind).toBe("approve");
    expect(approve.to).toBe(CASH);
    expect(approve.contractName).toBe("USDC");

    const call = result.steps[1] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(QUEUE); // the vault's per-vault bound queue
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(true);
    // The queue was resolved per-vault (not via a chain singleton).
    expect(deps.forwardQueues.queueFor).toHaveBeenCalledWith(VAULT);

    const expected = encodeFunctionData({ abi: ForwardCashQueueAbi, functionName: "requestCreate", args: [BigInt(cash)] });
    expect(call.data).toBe(expected);
  });

  it("targets the queue bound to THIS vault (per-vault binding, not the chain singleton)", async () => {
    const OTHER_QUEUE = "0x00000000000000000000000000000000000000ee";
    const deps = makeDeps({ allowances: [10_000_000n], queue: OTHER_QUEUE });
    const result = await buildForwardCreate(deps, VAULT, { account: ACCOUNT, cash: "1000000" });
    const call = result.steps[0] as { kind: string; to: string };
    expect(call.to).toBe(OTHER_QUEUE);
    expect(call.to).not.toBe(QUEUE);
  });

  it("omits the approve step when cash allowance already sufficient", async () => {
    const deps = makeDeps({ allowances: [10_000_000n] });
    const result = await buildForwardCreate(deps, VAULT, { account: ACCOUNT, cash: "1000000" });

    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(QUEUE);
    expect(call.needsPriorApproval).toBe(false);
  });

  it("throws not-deployed when no queue is bound for the vault", async () => {
    const deps = makeDeps({ queue: undefined });
    await expect(buildForwardCreate(deps, VAULT, { account: ACCOUNT, cash: "1000000" })).rejects.toThrow(/not-deployed/);
  });

  it("falls back to the queue stable token when the basket has no cashToken (registry)", async () => {
    const STABLE = "0x000000000000000000000000000000000000d0d0";
    const deps = makeDeps({ basket: { vaultAddress: VAULT, symbol: "IDX", cashToken: null } });
    // First multicall = readQueueStable (returns the stable); second = allowance check (0 → approve).
    deps.publicClient.multicall = vi
      .fn()
      .mockResolvedValueOnce([{ status: "success", result: STABLE }])
      .mockResolvedValueOnce([{ status: "success", result: 0n }]);
    deps.meta.getMany = vi.fn().mockResolvedValue({ [STABLE.toLowerCase()]: { symbol: "USDG", decimals: 18 } });

    const result = await buildForwardCreate(deps, VAULT, { account: ACCOUNT, cash: "1000000" });
    const approve = result.steps.find((s) => s.kind === "approve") as { to: string };
    expect(approve.to).toBe(STABLE);
  });

  it("throws when no cashToken and the queue stable can't be read", async () => {
    const deps = makeDeps({ basket: { vaultAddress: VAULT, symbol: "IDX", cashToken: null } });
    deps.publicClient.multicall = vi.fn().mockResolvedValueOnce([{ status: "failure" }]);
    await expect(buildForwardCreate(deps, VAULT, { account: ACCOUNT, cash: "1000000" })).rejects.toThrow(/cashToken/);
  });
});

describe("buildForwardRedeem", () => {
  it("emits approve(vault→queue) then call requestRedeem(shares) targeting the queue", async () => {
    const deps = makeDeps({ allowances: [0n] });
    const shares = "500000000000000000000"; // 500 shares (18-dec)

    const result = await buildForwardRedeem(deps, VAULT, { account: ACCOUNT, shares });

    expect(result.steps).toHaveLength(2);

    const approve = result.steps[0] as { kind: string; to: string; contractName: string };
    expect(approve.kind).toBe("approve");
    expect(approve.to).toBe(VAULT); // the share token is the vault itself
    expect(approve.contractName).toBe("IDX");

    const call = result.steps[1] as { kind: string; to: string; data: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(QUEUE); // the vault's per-vault bound queue
    expect(call.needsPriorApproval).toBe(true);
    expect(deps.forwardQueues.queueFor).toHaveBeenCalledWith(VAULT);

    const expected = encodeFunctionData({ abi: ForwardCashQueueAbi, functionName: "requestRedeem", args: [BigInt(shares)] });
    expect(call.data).toBe(expected);
  });

  it("throws not-deployed when no queue is bound for the vault", async () => {
    const deps = makeDeps({ queue: undefined });
    await expect(buildForwardRedeem(deps, VAULT, { account: ACCOUNT, shares: "1000000000000000000" })).rejects.toThrow(/not-deployed/);
  });

  it("approves the vault share token (not the cash token)", async () => {
    const deps = makeDeps({ allowances: [0n] });
    const result = await buildForwardRedeem(deps, VAULT, { account: ACCOUNT, shares: "1000000000000000000" });

    const approve = result.steps.find((s) => s.kind === "approve") as { to: string } | undefined;
    expect(approve?.to).toBe(VAULT);
    expect(approve?.to).not.toBe(CASH);
  });
});

describe("buildForwardCancel", () => {
  it("emits a single call cancel(ticketId) with no approve", async () => {
    const deps = makeDeps({});
    const ticketId = 7;

    const result = await buildForwardCancel(deps, VAULT, { account: ACCOUNT, ticketId });

    expect(result.steps).toHaveLength(1);
    expect(result.steps.filter((s) => s.kind === "approve")).toHaveLength(0);

    const call = result.steps[0] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(QUEUE); // the vault's per-vault bound queue
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);
    expect(deps.forwardQueues.queueFor).toHaveBeenCalledWith(VAULT);

    const expected = encodeFunctionData({ abi: ForwardCashQueueAbi, functionName: "cancel", args: [BigInt(ticketId)] });
    expect(call.data).toBe(expected);
  });

  it("does not read the basket or build approvals for cancel", async () => {
    const deps = makeDeps({});
    await buildForwardCancel(deps, VAULT, { account: ACCOUNT, ticketId: 1 });
    expect(deps.prisma.basket.findUnique).not.toHaveBeenCalled();
    expect(deps.publicClient.multicall).not.toHaveBeenCalled();
  });

  it("throws not-deployed when no queue is bound for the vault", async () => {
    const deps = makeDeps({ queue: undefined });
    await expect(buildForwardCancel(deps, VAULT, { account: ACCOUNT, ticketId: 1 })).rejects.toThrow(/not-deployed/);
  });
});
