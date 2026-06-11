import { decodeErrorResult } from "viem";
import { ForwardCashQueueAbi } from "@meridian/contracts";
import type { SettleGateGuardId } from "@meridian/sdk";

export const GATE_GUARD_IDS: readonly SettleGateGuardId[] = ["g0", "g1", "g2", "g3", "g6", "g7", "g8"];

const ERROR_TO_GUARD: Record<string, SettleGateGuardId> = {
  VaultNotBootstrapped: "g0",
  FeedNotSet: "g1",
  L2SourceMissing: "g1",
  NotOpen: "g2",
  NotSafe: "g3",
  InsufficientPrints: "g6",
  TwapBandBreached: "g7",
  PegStale: "g8",
  PegBreached: "g8",
};

export function guardForError(errorName: string): SettleGateGuardId | undefined {
  return ERROR_TO_GUARD[errorName];
}

/** Best-effort: pull a ForwardCashQueue custom-error name out of a revert error object. */
export function decodeGateRevert(err: unknown): string | undefined {
  // viem nests the revert data; walk the cause chain for a 0x... data string.
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const data = (cur as { data?: unknown }).data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      try {
        const decoded = decodeErrorResult({ abi: ForwardCashQueueAbi, data: data as `0x${string}` });
        if (decoded.errorName) return decoded.errorName;
      } catch {
        // not a queue custom error — keep walking
      }
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
