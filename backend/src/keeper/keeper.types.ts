/** pg-boss queue names for keeper jobs (producer role only). */
export const KEEPER_JOBS = {
  attestationPush: "attestation-push",
  rebalance: "rebalance",
  settle: "settle",
  forwardRecord: "forward-record",
  forwardSettle: "forward-settle",
} as const;

export type KeeperJobName = (typeof KEEPER_JOBS)[keyof typeof KEEPER_JOBS];

export interface AttestationPushPayload {
  vaultAddress: `0x${string}`;
  attestationId: string;
}

export interface RebalancePayload {
  vaultAddress: `0x${string}`;
}

export interface SettlePayload {
  vaultAddress: `0x${string}`;
  /** Optional cap on entries settled per run (batching); default = all pending. */
  limit?: number;
}

export interface KeeperResult {
  /** "submitted" (tx sent), "skipped" (idempotent/no-op), or "noop" (disabled/preconditions unmet). */
  status: "submitted" | "skipped" | "noop";
  txHash?: `0x${string}`;
  detail?: string;
}

/** Minimal wallet seam so services are testable without a real chain. */
export interface KeeperWallet {
  account: { address: `0x${string}` };
  writeContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<`0x${string}`>;
}
