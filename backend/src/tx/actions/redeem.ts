import { encodeFunctionData } from "viem";
import { BasketVaultAbi, CommittedVaultAbi } from "@meridian/contracts";
import type { ActionResult, BuiltStep } from "../action-registry.js";

type VaultType = "Basket" | "Managed" | "Committed" | "Rebalance" | "Registry";

interface BasketRow {
  vaultAddress: string;
  symbol: string;
  vaultType: VaultType;
  constituents: { token: string; unitQty: { toFixed: (n: number) => string } }[];
}

export interface RedeemDeps {
  prisma: {
    basket: { findUnique: (args: unknown) => Promise<BasketRow | null> };
  };
}

const VAULT_LABEL: Record<VaultType, string> = {
  Basket: "BasketVault",
  Managed: "ManagedVault",
  Committed: "CommittedVault",
  Rebalance: "ManagedRebalanceVault",
  Registry: "RegistryRebalanceVault",
};

export async function buildRedeem(
  deps: RedeemDeps,
  vault: string,
  { amount }: { account: string; amount: string },
): Promise<ActionResult> {
  const basket = await deps.prisma.basket.findUnique({
    where: { vaultAddress: vault },
    include: { constituents: true },
  });
  if (!basket) throw new Error(`basket ${vault} not found`);

  const amountBn = BigInt(amount);
  let data: `0x${string}`;

  if (basket.vaultType === "Committed") {
    // use-redeem.ts: CommittedVaultAbi.redeem(amount, recipe.tokens, recipe.unitQty)
    const tokens = basket.constituents.map((c) => c.token as `0x${string}`);
    const unitQty = basket.constituents.map((c) => BigInt(c.unitQty.toFixed(0)));
    data = encodeFunctionData({ abi: CommittedVaultAbi, functionName: "redeem", args: [amountBn, tokens, unitQty] });
  } else {
    // basket/managed/rebalance: BasketVaultAbi.redeem(amount)
    data = encodeFunctionData({ abi: BasketVaultAbi, functionName: "redeem", args: [amountBn] });
  }

  const call: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data,
    value: "0",
    contractName: VAULT_LABEL[basket.vaultType],
    label: `Redeem ${amount} ${basket.symbol}`,
    summary: `Burn ${amount} ${basket.symbol} shares and receive underlying tokens in-kind`,
    needsPriorApproval: false,
  };

  return { steps: [call], finalize: null };
}
