import { encodeFunctionData } from "viem";
import { RebalanceAuctionAbi } from "@meridian/contracts";
import type { ActionResult, BuiltStep } from "../action-registry.js";
import { buildApprovalSteps, type ApprovalDeps } from "./approvals.js";

export interface AuctionDeps extends ApprovalDeps {
  registry: { address: (capability: "RebalanceAuction") => `0x${string}` | undefined };
}

export interface AuctionOpenRequest {
  account: string;
  durationSec: number;
  release: { token: string; releaseOut: string }[];
  acquire: { token: string; startIn: string; endIn: string }[];
}

export interface AuctionBidRequest {
  account: string;
  acquire: { token: string; amount: string }[];
}

function resolveAuction(deps: AuctionDeps): `0x${string}` {
  // Singleton auction per chain — matches the FE (addresses[chainId].RebalanceAuction) and
  // use-auction.ts. Throw when undeployed; the builder maps the throw to a gated plan.
  const auction = deps.registry.address("RebalanceAuction");
  if (!auction) throw new Error("not-deployed: RebalanceAuction is not registered");
  return auction;
}

export function buildAuctionSetExecMode(
  deps: AuctionDeps,
  vault: string,
  { mode }: { mode: number },
): ActionResult {
  const auction = resolveAuction(deps);

  // PERMISSIONLESS (2) is contract-disabled (setExecMode reverts PermissionlessDisabled); only
  // MANAGER_ONLY (0) and ALLOWLIST (1) are settable. Reject 2 here so we never build a reverting tx.
  if (mode !== 0 && mode !== 1) {
    throw new Error(`invalid auction exec mode ${mode}: only 0 (manager-only) and 1 (allowlist) are allowed`);
  }

  // use-auction.ts: setExecMode(vault, mode) on RebalanceAuction.
  const data = encodeFunctionData({
    abi: RebalanceAuctionAbi,
    functionName: "setExecMode",
    args: [vault as `0x${string}`, mode],
  });
  const call: BuiltStep = {
    kind: "call",
    to: auction,
    data,
    value: "0",
    contractName: "RebalanceAuction",
    label: "Set auction execution mode",
    summary: "Set who may open rebalance auctions for this basket (manager-only or allowlist)",
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}

export function buildAuctionOpen(
  deps: AuctionDeps,
  vault: string,
  req: AuctionOpenRequest,
): ActionResult {
  const auction = resolveAuction(deps);

  // AuctionPanel release rows {token, out} → release[]/releaseOut[]; acquire rows {token, start, end}
  // → acquire[]/startIn[]/endIn[]. Amounts arrive as 18-dec base-unit strings (parseUnits(_, 18) in
  // the panel). Arg order mirrors the ABI + use-auction.ts:
  // open(vault, release[], releaseOut[], acquire[], startIn[], endIn[], duration). The opener releases
  // vault-custodied tokens (not its own), so no bidder approval is needed here.
  const data = encodeFunctionData({
    abi: RebalanceAuctionAbi,
    functionName: "open",
    args: [
      vault as `0x${string}`,
      req.release.map((r) => r.token as `0x${string}`),
      req.release.map((r) => BigInt(r.releaseOut)),
      req.acquire.map((a) => a.token as `0x${string}`),
      req.acquire.map((a) => BigInt(a.startIn)),
      req.acquire.map((a) => BigInt(a.endIn)),
      BigInt(req.durationSec),
    ],
  });
  const call: BuiltStep = {
    kind: "call",
    to: auction,
    data,
    value: "0",
    contractName: "RebalanceAuction",
    label: "Open rebalance auction",
    summary: "Open a Dutch auction that swaps the vault's release legs for the acquire legs over the duration",
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}

export async function buildAuctionBid(
  deps: AuctionDeps,
  vault: string,
  req: AuctionBidRequest,
): Promise<ActionResult> {
  const auction = resolveAuction(deps);

  // The bid pulls the live auction's acquire tokens from the bidder via transferFrom, so each must be
  // approved to the auction first. AuctionPanel makes the bidder enter those tokens (not readable
  // on-chain — _auc is private) paired with their currentAcquireIn amounts; the request carries that
  // {token, amount} list so we can emit the approvals. The on-chain call is bid(vault).
  const approvals = await buildApprovalSteps(
    deps,
    req.account,
    auction,
    req.acquire.map((a) => ({ token: a.token, amount: BigInt(a.amount) })),
    "auction",
  );

  const data = encodeFunctionData({
    abi: RebalanceAuctionAbi,
    functionName: "bid",
    args: [vault as `0x${string}`],
  });
  const call: BuiltStep = {
    kind: "call",
    to: auction,
    data,
    value: "0",
    contractName: "RebalanceAuction",
    label: "Bid on rebalance auction",
    summary: "Fill the live Dutch auction; pulls the acquire tokens from your wallet and pays the opener a tip",
    needsPriorApproval: true,
  };
  return { steps: [...approvals, call], finalize: null };
}
