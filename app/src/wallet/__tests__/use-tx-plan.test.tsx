import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { TxPlan } from "@meridian/sdk";

const mockSendTransactionAsync = vi.fn();
const mockSignTypedDataAsync = vi.fn();
const mockWaitForTransactionReceipt = vi.fn();

vi.mock("wagmi", () => ({
  useSendTransaction: () => ({ sendTransactionAsync: mockSendTransactionAsync }),
  useSignTypedData: () => ({ signTypedDataAsync: mockSignTypedDataAsync }),
  usePublicClient: () => ({ waitForTransactionReceipt: mockWaitForTransactionReceipt }),
}));

import { useTxPlan } from "../use-tx-plan";
import { addresses, CHAIN_IDS } from "@meridian/contracts";

// A real deployed address on the home chain is in the SDK address book → passes assertTxPlanSafe.
// Taken from the generated map so redeployments never stale this test.
const VAULT = addresses[CHAIN_IDS.robinhoodChainTestnet]["BasketVault"]!;
// A per-basket vault clone: NOT in the static address book, NOT a constituent token.
// Only an explicit allowlist seed lets a step target it.
const VAULT_CLONE = "0x000000000000000000000000000000000000c10e" as const;
// A constituent token the caller whitelists explicitly.
const TOKEN = "0x000000000000000000000000000000000000cccc" as const;
const SPENDER = "0x000000000000000000000000000000000000bbbb" as const;
const OWNER = "0x000000000000000000000000000000000000aaaa" as const;

// 65-byte sig: r (0x11*32) + s (0x22*32) + v (0x1b = 27) — parseSignature accepts this.
const MOCK_SIG = ("0x" + "11".repeat(32) + "22".repeat(32) + "1b") as `0x${string}`;

function sendStep(kind: "approve" | "call", to: string, data = "0xdead", value = "0"): TxPlan["steps"][number] {
  return { kind, to, data, value, contractName: "Mock", label: kind, summary: "s", simulated: true };
}

beforeEach(() => {
  mockSendTransactionAsync.mockReset().mockResolvedValue("0xhash");
  mockSignTypedDataAsync.mockReset().mockResolvedValue(MOCK_SIG);
  mockWaitForTransactionReceipt.mockReset().mockResolvedValue({});
});

describe("useTxPlan", () => {
  it("executes [approve, call] sends in order with bigint value, status success", async () => {
    const plan: TxPlan = {
      chainId: 46630,
      gate: { gated: false, reason: "none" },
      steps: [
        sendStep("approve", TOKEN, "0xa11ce", "0"),
        sendStep("call", VAULT, "0xca11", "5"),
      ],
      finalize: null,
    };
    const { result } = renderHook(() => useTxPlan([TOKEN]));
    await act(async () => {
      await result.current.run(() => Promise.resolve(plan));
    });
    expect(mockSendTransactionAsync).toHaveBeenCalledTimes(2);
    expect(mockSendTransactionAsync).toHaveBeenNthCalledWith(1, { to: TOKEN, data: "0xa11ce", value: 0n });
    expect(mockSendTransactionAsync).toHaveBeenNthCalledWith(2, { to: VAULT, data: "0xca11", value: 5n });
    expect(mockWaitForTransactionReceipt).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("success");
    expect(result.current.error).toBeNull();
  });

  it("signs sign712, calls finalizeFetcher with permits, sends the finalize call", async () => {
    const plan: TxPlan = {
      chainId: 46630,
      gate: { gated: false, reason: "none" },
      steps: [
        {
          kind: "sign712",
          token: TOKEN,
          label: "permit",
          summary: "s",
          typedData: {
            domain: { name: "Tok", version: "1", chainId: 46630, verifyingContract: TOKEN },
            types: { Permit: [{ name: "owner", type: "address" }] },
            primaryType: "Permit",
            message: { owner: OWNER, spender: SPENDER, value: "1000", nonce: "0", deadline: "9999" },
          },
        },
      ],
      finalize: { path: "/tx/mint/finalize" },
    };
    const finalizePlan: TxPlan = {
      chainId: 46630,
      gate: { gated: false, reason: "none" },
      steps: [sendStep("call", VAULT, "0xf1na1", "0")],
      finalize: null,
    };
    const finalizeFetcher = vi.fn().mockResolvedValue(finalizePlan);

    const { result } = renderHook(() => useTxPlan([TOKEN]));
    await act(async () => {
      await result.current.run(() => Promise.resolve(plan), finalizeFetcher);
    });

    expect(mockSignTypedDataAsync).toHaveBeenCalledTimes(1);
    // bigint conversion of uint256 message fields
    const signArg = mockSignTypedDataAsync.mock.calls[0]![0];
    expect(signArg.message.value).toBe(1000n);
    expect(signArg.message.nonce).toBe(0n);
    expect(signArg.message.deadline).toBe(9999n);

    expect(finalizeFetcher).toHaveBeenCalledTimes(1);
    const permits = finalizeFetcher.mock.calls[0]![0];
    expect(permits).toHaveLength(1);
    expect(permits[0]).toMatchObject({
      token: TOKEN,
      value: "1000",
      deadline: "9999",
      v: 27,
      r: "0x" + "11".repeat(32),
      s: "0x" + "22".repeat(32),
    });

    // finalize plan's call step is sent (and the sign712 produced no send)
    expect(mockSendTransactionAsync).toHaveBeenCalledTimes(1);
    expect(mockSendTransactionAsync).toHaveBeenCalledWith({ to: VAULT, data: "0xf1na1", value: 0n });
    expect(result.current.status).toBe("success");
  });

  it("gated plan → error status, error contains reason, no sends", async () => {
    const plan: TxPlan = {
      chainId: 46630,
      gate: { gated: true, reason: "frozen" },
      steps: [],
      finalize: null,
    };
    const { result } = renderHook(() => useTxPlan([TOKEN]));
    await act(async () => {
      await result.current.run(() => Promise.resolve(plan));
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("frozen");
    expect(mockSendTransactionAsync).not.toHaveBeenCalled();
    expect(mockSignTypedDataAsync).not.toHaveBeenCalled();
  });

  it("rejects a plan whose step targets an unknown address (assertTxPlanSafe)", async () => {
    const plan: TxPlan = {
      chainId: 46630,
      gate: { gated: false, reason: "none" },
      steps: [sendStep("call", "0x000000000000000000000000000000000000dead", "0xbad", "0")],
      finalize: null,
    };
    const { result } = renderHook(() => useTxPlan([TOKEN]));
    await act(async () => {
      await result.current.run(() => Promise.resolve(plan));
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("unknown destination");
    expect(mockSendTransactionAsync).not.toHaveBeenCalled();
  });

  // Regression: a mint/redeem plan's terminal call targets the per-basket vault clone, which is
  // NOT in the address book and NOT a constituent token. It must pass only when the clone is in
  // the useTxPlan allowlist seed (the OrderRail fix), and fail otherwise.
  const vaultClonePlan: TxPlan = {
    chainId: 46630,
    gate: { gated: false, reason: "none" },
    steps: [sendStep("call", VAULT_CLONE, "0xca11", "0")],
    finalize: null,
  };

  it("accepts a vault-clone destination when the clone is in the allowlist seed", async () => {
    const { result } = renderHook(() => useTxPlan([VAULT_CLONE]));
    await act(async () => {
      await result.current.run(() => Promise.resolve(vaultClonePlan));
    });
    expect(result.current.status).toBe("success");
    expect(result.current.error).toBeNull();
    expect(mockSendTransactionAsync).toHaveBeenCalledWith({ to: VAULT_CLONE, data: "0xca11", value: 0n });
  });

  it("rejects a vault-clone destination when the clone is NOT in the allowlist seed", async () => {
    const { result } = renderHook(() => useTxPlan([TOKEN]));
    await act(async () => {
      await result.current.run(() => Promise.resolve(vaultClonePlan));
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("unknown destination");
    expect(mockSendTransactionAsync).not.toHaveBeenCalled();
  });
});
