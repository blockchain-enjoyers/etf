import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData } from "viem";
import { BasketVaultAbi, CommittedVaultAbi } from "@meridian/contracts";
import { buildRedeem } from "./redeem.js";

const VAULT = "0x000000000000000000000000000000000000aa01";
const ACCOUNT = "0x0000000000000000000000000000000000000001";
const TOKEN_A = "0x000000000000000000000000000000000000aaaa";
const TOKEN_B = "0x000000000000000000000000000000000000bbbb";

const dec = (v: string) => ({ toFixed: (_n: number) => v });

function makeDeps(basket: unknown) {
  return {
    prisma: {
      basket: { findUnique: vi.fn().mockResolvedValue(basket) },
    },
  };
}

describe("buildRedeem — non-committed vault (BasketVault.redeem)", () => {
  it("emits exactly one call step targeting the vault with BasketVaultAbi.redeem(amount)", async () => {
    const basket = {
      vaultAddress: VAULT,
      symbol: "IDX",
      vaultType: "Basket",
      constituents: [{ token: TOKEN_A, unitQty: dec("1000000000000000000") }],
    };
    const amount = "500000000000000000000";
    const deps = makeDeps(basket);

    const result = await buildRedeem(deps, VAULT, { account: ACCOUNT, amount });

    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(VAULT);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);

    // Pin selector: independent encode must match exactly.
    const expected = encodeFunctionData({ abi: BasketVaultAbi, functionName: "redeem", args: [BigInt(amount)] });
    expect(call.data).toBe(expected);
  });

  it("Managed vault uses BasketVaultAbi.redeem (not committed path)", async () => {
    const basket = {
      vaultAddress: VAULT,
      symbol: "MGD",
      vaultType: "Managed",
      constituents: [{ token: TOKEN_A, unitQty: dec("1000000000000000000") }],
    };
    const amount = "1000000000000000000";
    const deps = makeDeps(basket);

    const result = await buildRedeem(deps, VAULT, { account: ACCOUNT, amount });

    const call = result.steps[0] as { data: string };
    const expected = encodeFunctionData({ abi: BasketVaultAbi, functionName: "redeem", args: [BigInt(amount)] });
    expect(call.data).toBe(expected);
  });

  it("Rebalance vault uses BasketVaultAbi.redeem", async () => {
    const basket = {
      vaultAddress: VAULT,
      symbol: "RBL",
      vaultType: "Rebalance",
      constituents: [{ token: TOKEN_A, unitQty: dec("1000000000000000000") }],
    };
    const amount = "250000000000000000";
    const deps = makeDeps(basket);

    const result = await buildRedeem(deps, VAULT, { account: ACCOUNT, amount });

    const call = result.steps[0] as { data: string };
    const expected = encodeFunctionData({ abi: BasketVaultAbi, functionName: "redeem", args: [BigInt(amount)] });
    expect(call.data).toBe(expected);
  });

  it("returns no approve steps — in-kind redeem needs no approvals", async () => {
    const basket = {
      vaultAddress: VAULT,
      symbol: "IDX",
      vaultType: "Basket",
      constituents: [{ token: TOKEN_A, unitQty: dec("1000000000000000000") }],
    };
    const deps = makeDeps(basket);
    const result = await buildRedeem(deps, VAULT, { account: ACCOUNT, amount: "1000" });

    const approveSteps = result.steps.filter((s) => s.kind === "approve");
    expect(approveSteps).toHaveLength(0);
    expect(result.steps).toHaveLength(1);
  });
});

describe("buildRedeem — committed vault (CommittedVaultAbi.redeem)", () => {
  it("encodes redeem(amount, tokens, unitQty) with recipe from prisma constituents", async () => {
    const basket = {
      vaultAddress: VAULT,
      symbol: "CMT",
      vaultType: "Committed",
      constituents: [
        { token: TOKEN_A, unitQty: dec("1000000000000000000") },
        { token: TOKEN_B, unitQty: dec("2000000000000000000") },
      ],
    };
    const amount = "3000000000000000000";
    const deps = makeDeps(basket);

    const result = await buildRedeem(deps, VAULT, { account: ACCOUNT, amount });

    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; data: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(VAULT);
    expect(call.needsPriorApproval).toBe(false);

    // Pin selector: independent encode with (amount, tokens[], unitQty[]) must match.
    const expected = encodeFunctionData({
      abi: CommittedVaultAbi,
      functionName: "redeem",
      args: [BigInt(amount), [TOKEN_A, TOKEN_B], [1000000000000000000n, 2000000000000000000n]],
    });
    expect(call.data).toBe(expected);
  });

  it("committed redeem also has no approve steps", async () => {
    const basket = {
      vaultAddress: VAULT,
      symbol: "CMT",
      vaultType: "Committed",
      constituents: [{ token: TOKEN_A, unitQty: dec("1000000000000000000") }],
    };
    const deps = makeDeps(basket);
    const result = await buildRedeem(deps, VAULT, { account: ACCOUNT, amount: "1000" });

    expect(result.steps.filter((s) => s.kind === "approve")).toHaveLength(0);
  });
});
