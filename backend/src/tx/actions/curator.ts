import { encodeFunctionData } from "viem";
import { ManagedRebalanceVaultAbi } from "@meridian/contracts";
import type { ActionResult, BuiltStep } from "../action-registry.js";

// use-rebalance-curator.ts: scheduleTarget(tokens, unitQty) on the vault itself. Pure encode —
// the manager-mismatch gate runs in the builder before this is ever reached.
export function buildCuratorSchedule(
  vault: string,
  { tokens, unitQty }: { tokens: string[]; unitQty: string[] },
): ActionResult {
  const data = encodeFunctionData({
    abi: ManagedRebalanceVaultAbi,
    functionName: "scheduleTarget",
    args: [tokens as `0x${string}`[], unitQty.map(BigInt)],
  });
  const call: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data,
    value: "0",
    contractName: "ManagedRebalanceVault",
    label: "Schedule rebalance target",
    summary: "Schedule a new target basket; activates after the on-chain timelock",
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}

// use-rebalance-curator.ts: activateTarget() on the vault — applies the timelocked target.
export function buildCuratorActivate(vault: string): ActionResult {
  const data = encodeFunctionData({ abi: ManagedRebalanceVaultAbi, functionName: "activateTarget" });
  const call: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data,
    value: "0",
    contractName: "ManagedRebalanceVault",
    label: "Activate rebalance target",
    summary: "Activate the scheduled target basket once its timelock has elapsed",
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}
