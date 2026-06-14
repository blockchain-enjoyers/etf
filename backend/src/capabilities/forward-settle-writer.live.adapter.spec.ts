import { describe, it, expect, vi, beforeEach } from "vitest";
import { maxUint256 } from "viem";
import { LiveForwardSettleWriter } from "./forward-settle-writer.live.adapter.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const QUEUE = "0xqueue" as const;
const AP = "0xfiller" as const;
const VAULT = "0xvault" as const;
const TOK_A = "0xaaa" as const;
const TOK_B = "0xbbb" as const;

function make(opts: {
  queue?: string | undefined;
  wallet?: boolean;
  held?: `0x${string}`[];
  allowances?: bigint[]; // per held token, in order
}) {
  const allowances = opts.allowances ?? [];
  const readContract = vi.fn(async (args: { functionName: string; address: `0x${string}` }) => {
    if (args.functionName === "allowance") {
      const idx = (opts.held ?? []).indexOf(args.address);
      return allowances[idx] ?? 0n;
    }
    throw new Error(`unexpected read ${args.functionName}`);
  });
  const writeContract = vi.fn(async (_args: Record<string, unknown>) => "0xtx" as `0x${string}`);
  const waitForTransactionReceipt = vi.fn(async () => ({}));
  const chain = {
    chain: {},
    account: { address: "0xkeeper" },
    walletClient: opts.wallet === false ? undefined : { writeContract },
    publicClient: { readContract, waitForTransactionReceipt },
  };
  const forwardQueues = { queueFor: vi.fn(() => ("queue" in opts ? opts.queue : QUEUE)) };
  const rebVault = { heldTokens: vi.fn(async () => opts.held ?? []) };
  const signer = { payloadsFor: vi.fn(async () => []) };
  const writer = new LiveForwardSettleWriter(
    chain as never,
    forwardQueues as never,
    rebVault as never,
    signer as never,
  );
  return { writer, writeContract, waitForTransactionReceipt, readContract };
}

beforeEach(() => vi.clearAllMocks());

describe("LiveForwardSettleWriter.approve", () => {
  it("throws CapabilityUnavailable when the vault has no queue", async () => {
    const { writer } = make({ queue: undefined });
    await expect(writer.approve(VAULT, AP)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("throws CapabilityUnavailable when there is no walletClient", async () => {
    const { writer } = make({ wallet: false });
    await expect(writer.approve(VAULT, AP)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("approves each under-allowanced constituent to max and waits for each receipt", async () => {
    const { writer, writeContract, waitForTransactionReceipt } = make({
      held: [TOK_A, TOK_B],
      allowances: [0n, 0n],
    });
    const tx = await writer.approve(VAULT, AP);
    expect(tx).toBe("0xtx");
    expect(writeContract).toHaveBeenCalledTimes(2);
    expect(writeContract.mock.calls[0]![0]).toMatchObject({
      address: AP,
      functionName: "approveConstituent",
      args: [TOK_A, QUEUE, maxUint256],
    });
    expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2);
  });

  it("skips already-max-approved constituents (idempotent) and returns ZERO_HASH when none need it", async () => {
    const { writer, writeContract } = make({
      held: [TOK_A, TOK_B],
      allowances: [maxUint256, maxUint256],
    });
    const tx = await writer.approve(VAULT, AP);
    expect(writeContract).not.toHaveBeenCalled();
    expect(tx).toBe(ZERO_HASH);
  });

  it("only re-approves the constituents below threshold", async () => {
    const { writer, writeContract } = make({
      held: [TOK_A, TOK_B],
      allowances: [maxUint256, 0n],
    });
    await writer.approve(VAULT, AP);
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract.mock.calls[0]![0]).toMatchObject({ args: [TOK_B, QUEUE, maxUint256] });
  });
});
