import { encodeFunctionData } from "viem";
import { BasketNavObserverAbi, ForwardCashQueueAbi } from "@meridian/contracts";
import type { ActionResult, BuiltStep } from "../action-registry.js";

export interface KeeperDeps {
  registry: { address: (capability: "BasketNavObserver" | "ForwardCashQueue") => `0x${string}` | undefined };
  rebVault: { heldTokens: (vault: `0x${string}`) => Promise<`0x${string}`[]> };
  signer: { payloadsFor: (token: string) => Promise<readonly `0x${string}`[]> };
}

export async function buildKeeperRecord(deps: KeeperDeps, vault: string): Promise<ActionResult> {
  const observer = deps.registry.address("BasketNavObserver");
  if (!observer) throw new Error("not-deployed: BasketNavObserver is not registered");

  const held = await deps.rebVault.heldTokens(vault as `0x${string}`);
  const payloads = await Promise.all(held.map((t) => deps.signer.payloadsFor(t)));
  const data = encodeFunctionData({
    abi: BasketNavObserverAbi,
    functionName: "record",
    args: [vault as `0x${string}`, held, payloads],
  });
  const call: BuiltStep = {
    kind: "call",
    to: observer,
    data,
    value: "0",
    contractName: "BasketNavObserver",
    label: "Record NAV observation",
    summary: "Print a holdings-NAV observation for the basket's TWAP window",
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}

export async function buildKeeperSettle(
  deps: KeeperDeps,
  vault: string,
  { ticketIds, ap }: { ticketIds: number[]; ap: string },
): Promise<ActionResult> {
  const queue = deps.registry.address("ForwardCashQueue");
  if (!queue) throw new Error("not-deployed: ForwardCashQueue is not registered");

  const held = await deps.rebVault.heldTokens(vault as `0x${string}`);
  const payloads = await Promise.all(held.map((t) => deps.signer.payloadsFor(t)));
  const data = encodeFunctionData({
    abi: ForwardCashQueueAbi,
    functionName: "settle",
    args: [ticketIds.map(BigInt), held, payloads, ap as `0x${string}`],
  });
  const call: BuiltStep = {
    kind: "call",
    to: queue,
    data,
    value: "0",
    contractName: "ForwardCashQueue",
    label: `Settle ${ticketIds.length} forward ticket(s)`,
    summary: "Settle queued forward tickets at the printed NAV via the AP filler",
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}
