import { encodeFunctionData, erc20Abi } from "viem";
import type { BuiltStep } from "../action-registry.js";
import { approveSummary } from "../summaries.js";

export interface ApprovalDeps {
  publicClient: { multicall: (args: never) => Promise<{ status: string; result?: unknown }[]> };
  meta: { getMany: (tokens: string[]) => Promise<Record<string, { symbol: string; decimals: number }>> };
}

export async function buildApprovalSteps(
  deps: ApprovalDeps,
  account: string,
  spender: string,
  needs: { token: string; amount: bigint }[],
  spenderLabel = "vault",
): Promise<BuiltStep[]> {
  if (needs.length === 0) return [];
  const allowances = await deps.publicClient.multicall({
    allowFailure: true,
    contracts: needs.map((n) => ({
      address: n.token as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [account, spender],
    })),
  } as never);
  const under = needs.filter((n, i) => {
    const r = allowances[i];
    const allowance = r?.status === "success" ? (r.result as bigint) : 0n;
    return allowance < n.amount;
  });
  if (under.length === 0) return [];
  const meta = await deps.meta.getMany(under.map((u) => u.token));
  return under.map((u) => {
    const m = meta[u.token.toLowerCase()] ?? { symbol: u.token.slice(0, 6), decimals: 18 };
    return {
      kind: "approve" as const,
      to: u.token as `0x${string}`,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender as `0x${string}`, u.amount] }),
      value: "0",
      contractName: m.symbol,
      label: `Approve ${m.symbol}`,
      summary: approveSummary(u.amount, m.decimals, m.symbol, spenderLabel),
    };
  });
}
