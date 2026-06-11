import { encodeFunctionData } from "viem";
import { ForwardCashQueueAbi } from "@meridian/contracts";
import type { ActionResult, BuiltStep } from "../action-registry.js";
import { buildApprovalSteps, type ApprovalDeps } from "./approvals.js";

interface ForwardBasketRow {
  vaultAddress: string;
  symbol: string;
  cashToken: string | null;
}

export interface ForwardDeps extends ApprovalDeps {
  prisma: {
    basket: { findUnique: (args: unknown) => Promise<ForwardBasketRow | null> };
  };
  forwardQueues: { queueFor: (vault: string) => string | undefined };
}

function resolveQueue(deps: ForwardDeps, vault: string): `0x${string}` {
  // Per-vault queue binding — mirrors the read path (ForwardService -> ForwardQueueRegistry.queueFor).
  // Each rebalance vault has its own ForwardCashQueue; using the chain singleton could route a
  // ticket into another vault's queue. Throw when unbound; the builder maps the throw to a gated plan.
  const queue = deps.forwardQueues.queueFor(vault);
  if (!queue) throw new Error("not-deployed: no forward queue for this vault");
  return queue as `0x${string}`;
}

async function findBasket(deps: ForwardDeps, vault: string): Promise<ForwardBasketRow> {
  const basket = await deps.prisma.basket.findUnique({ where: { vaultAddress: vault } });
  if (!basket) throw new Error(`basket ${vault} not found`);
  return basket;
}

export async function buildForwardCreate(
  deps: ForwardDeps,
  vault: string,
  { account, cash }: { account: string; cash: string },
): Promise<ActionResult> {
  const queue = resolveQueue(deps, vault);
  const basket = await findBasket(deps, vault);
  if (!basket.cashToken) throw new Error(`basket ${vault} has no cashToken`);

  const cashBn = BigInt(cash);
  // Queue pulls the cash leg via transferFrom — approve the cash token to the queue.
  const approvals = await buildApprovalSteps(deps, account, queue, [{ token: basket.cashToken, amount: cashBn }], "queue");

  // use-forward-queue.ts: requestCreate(cash)
  const data = encodeFunctionData({ abi: ForwardCashQueueAbi, functionName: "requestCreate", args: [cashBn] });
  const call: BuiltStep = {
    kind: "call",
    to: queue,
    data,
    value: "0",
    contractName: "ForwardCashQueue",
    label: `Queue create ${basket.symbol}`,
    summary: `Queue a forward create for ${basket.symbol}; settles at the next market open`,
    needsPriorApproval: approvals.length > 0,
  };

  return { steps: [...approvals, call], finalize: null };
}

export async function buildForwardRedeem(
  deps: ForwardDeps,
  vault: string,
  { account, shares }: { account: string; shares: string },
): Promise<ActionResult> {
  const queue = resolveQueue(deps, vault);
  const basket = await findBasket(deps, vault);

  const sharesBn = BigInt(shares);
  // Queue escrows shares via safeTransferFrom — approve the share token (the vault) to the queue.
  const approvals = await buildApprovalSteps(deps, account, queue, [{ token: vault, amount: sharesBn }], "queue");

  // use-forward-queue.ts: requestRedeem(shares)
  const data = encodeFunctionData({ abi: ForwardCashQueueAbi, functionName: "requestRedeem", args: [sharesBn] });
  const call: BuiltStep = {
    kind: "call",
    to: queue,
    data,
    value: "0",
    contractName: "ForwardCashQueue",
    label: `Queue redeem ${basket.symbol}`,
    summary: `Queue a forward redeem of ${basket.symbol}; settles at the next market open`,
    needsPriorApproval: approvals.length > 0,
  };

  return { steps: [...approvals, call], finalize: null };
}

export async function buildForwardCancel(
  deps: ForwardDeps,
  vault: string,
  { ticketId }: { account: string; ticketId: number },
): Promise<ActionResult> {
  const queue = resolveQueue(deps, vault);

  // use-forward-queue.ts: cancel(id) — no approval needed.
  const data = encodeFunctionData({ abi: ForwardCashQueueAbi, functionName: "cancel", args: [BigInt(ticketId)] });
  const call: BuiltStep = {
    kind: "call",
    to: queue,
    data,
    value: "0",
    contractName: "ForwardCashQueue",
    label: `Cancel forward ticket #${ticketId}`,
    summary: `Cancel forward ticket #${ticketId} and release escrow`,
    needsPriorApproval: false,
  };

  return { steps: [call], finalize: null };
}
