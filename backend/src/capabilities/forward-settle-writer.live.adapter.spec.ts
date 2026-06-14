import { describe, it, expect, vi, beforeEach } from "vitest";
import { maxUint256 } from "viem";
import { LiveForwardSettleWriter } from "./forward-settle-writer.live.adapter.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const QUEUE = "0xqueue" as const;
const AP = "0xfiller" as const;
const VAULT = "0xvault" as const;
const TOK_A = "0x000000000000000000000000000000000000000a" as const;
const TOK_B = "0x000000000000000000000000000000000000000b" as const;
const idOf = (t: string) => BigInt(t);

type TokState = { allowance?: bigint; claims?: bigint; holdings?: bigint; real?: bigint };

function make(opts: {
  queue?: string | undefined;
  wallet?: boolean;
  registry?: boolean;
  isOperator?: boolean;
  held?: `0x${string}`[];
  state?: Record<string, TokState>; // keyed by token address
}) {
  const held = opts.held ?? [];
  const state = opts.state ?? {};
  const byId = new Map(held.map((t) => [idOf(t), t]));

  const readContract = vi.fn(
    async (args: { functionName: string; address: `0x${string}`; args?: readonly unknown[] }) => {
      switch (args.functionName) {
        case "isRegistry":
          return opts.registry ?? false;
        case "isOperator":
          return opts.isOperator ?? false;
        case "allowance":
          return state[args.address]?.allowance ?? 0n;
        case "holdingsOf":
          return state[(args.args as readonly unknown[])[0] as string]?.holdings ?? 0n;
        case "balanceOf": {
          const a = args.args as readonly unknown[];
          if (a.length === 2) return state[byId.get(a[1] as bigint)!]?.claims ?? 0n; // ERC-6909 (owner,id)
          return state[args.address]?.real ?? 0n; // ERC-20 (owner)
        }
        default:
          throw new Error(`unexpected read ${args.functionName}`);
      }
    },
  );
  const writeContract = vi.fn(async (_args: Record<string, unknown>) => "0xtx" as `0x${string}`);
  const waitForTransactionReceipt = vi.fn(async () => ({}));
  const chain = {
    chain: {},
    account: { address: "0xkeeper" },
    walletClient: opts.wallet === false ? undefined : { writeContract },
    publicClient: { readContract, waitForTransactionReceipt },
  };
  const forwardQueues = { queueFor: vi.fn(() => ("queue" in opts ? opts.queue : QUEUE)) };
  const rebVault = { heldTokens: vi.fn(async () => held) };
  const signer = { payloadsFor: vi.fn(async () => []) };
  const writer = new LiveForwardSettleWriter(
    chain as never,
    forwardQueues as never,
    rebVault as never,
    signer as never,
  );
  return { writer, writeContract, waitForTransactionReceipt };
}

const call = (mock: ReturnType<typeof vi.fn>, i: number) => mock.mock.calls[i]![0] as Record<string, unknown>;

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

  describe("managed vault (ERC-20 pull)", () => {
    it("max-approves each under-allowanced constituent and waits each receipt", async () => {
      const { writer, writeContract, waitForTransactionReceipt } = make({
        registry: false,
        held: [TOK_A, TOK_B],
        state: { [TOK_A]: { allowance: 0n }, [TOK_B]: { allowance: 0n } },
      });
      const tx = await writer.approve(VAULT, AP);
      expect(tx).toBe("0xtx");
      expect(writeContract).toHaveBeenCalledTimes(2);
      expect(call(writeContract, 0)).toMatchObject({
        address: AP,
        functionName: "approveConstituent",
        args: [TOK_A, QUEUE, maxUint256],
      });
      expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2);
    });

    it("skips already-max-approved constituents (idempotent), returns ZERO_HASH when none need it", async () => {
      const { writer, writeContract } = make({
        registry: false,
        held: [TOK_A, TOK_B],
        state: { [TOK_A]: { allowance: maxUint256 }, [TOK_B]: { allowance: maxUint256 } },
      });
      const tx = await writer.approve(VAULT, AP);
      expect(writeContract).not.toHaveBeenCalled();
      expect(tx).toBe(ZERO_HASH);
    });
  });

  describe("registry vault (ERC-6909 claim pull)", () => {
    it("authorizes the queue as operator when not yet operator", async () => {
      const { writer, writeContract } = make({
        registry: true,
        isOperator: false,
        held: [TOK_A],
        state: { [TOK_A]: { claims: 100n, holdings: 100n, real: 0n } }, // claims already meet target -> no wrap
      });
      await writer.approve(VAULT, AP);
      expect(writeContract).toHaveBeenCalledTimes(1);
      expect(call(writeContract, 0)).toMatchObject({
        functionName: "setVaultOperator",
        args: [VAULT, QUEUE],
      });
    });

    it("skips setOperator when already operator and claims are provisioned (ZERO_HASH)", async () => {
      const { writer, writeContract } = make({
        registry: true,
        isOperator: true,
        held: [TOK_A],
        state: { [TOK_A]: { claims: 100n, holdings: 100n, real: 999n } },
      });
      const tx = await writer.approve(VAULT, AP);
      expect(writeContract).not.toHaveBeenCalled();
      expect(tx).toBe(ZERO_HASH);
    });

    it("wraps the per-token claim shortfall up to the vault holding", async () => {
      const { writer, writeContract } = make({
        registry: true,
        isOperator: true,
        held: [TOK_A, TOK_B],
        state: {
          [TOK_A]: { claims: 30n, holdings: 100n, real: 1000n }, // shortfall 70, real ample -> wrap 70
          [TOK_B]: { claims: 200n, holdings: 100n, real: 1000n }, // already over target -> skip
        },
      });
      await writer.approve(VAULT, AP);
      expect(writeContract).toHaveBeenCalledTimes(1);
      expect(call(writeContract, 0)).toMatchObject({
        functionName: "wrapInventory",
        args: [VAULT, [TOK_A], [70n]],
      });
    });

    it("caps the wrap amount at the filler's real ERC-20 balance", async () => {
      const { writer, writeContract } = make({
        registry: true,
        isOperator: true,
        held: [TOK_A],
        state: { [TOK_A]: { claims: 0n, holdings: 100n, real: 40n } }, // shortfall 100, only 40 real -> wrap 40
      });
      await writer.approve(VAULT, AP);
      expect(call(writeContract, 0)).toMatchObject({
        functionName: "wrapInventory",
        args: [VAULT, [TOK_A], [40n]],
      });
    });

    it("sets operator AND wraps when both are needed", async () => {
      const { writer, writeContract } = make({
        registry: true,
        isOperator: false,
        held: [TOK_A],
        state: { [TOK_A]: { claims: 0n, holdings: 50n, real: 1000n } },
      });
      const tx = await writer.approve(VAULT, AP);
      expect(writeContract).toHaveBeenCalledTimes(2);
      expect(call(writeContract, 0)).toMatchObject({ functionName: "setVaultOperator" });
      expect(call(writeContract, 1)).toMatchObject({ functionName: "wrapInventory", args: [VAULT, [TOK_A], [50n]] });
      expect(tx).toBe("0xtx");
    });

    it("does not wrap a token the filler cannot fund (real balance 0)", async () => {
      const { writer, writeContract } = make({
        registry: true,
        isOperator: true,
        held: [TOK_A],
        state: { [TOK_A]: { claims: 0n, holdings: 100n, real: 0n } },
      });
      const tx = await writer.approve(VAULT, AP);
      expect(writeContract).not.toHaveBeenCalled();
      expect(tx).toBe(ZERO_HASH);
    });
  });
});
