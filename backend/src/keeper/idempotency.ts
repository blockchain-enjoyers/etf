/** Deterministic idempotency / singleton keys for keeper jobs. */

export function attestationKey(vaultAddress: string, attestationId: string): string {
  return `attestation:${vaultAddress}:${attestationId}`;
}

/** One rebalance per vault per UTC day. */
export function rebalanceKey(vaultAddress: string, at: Date = new Date()): string {
  const day = at.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return `rebalance:${vaultAddress}:${day}`;
}

export function settleEntryKey(vaultAddress: string, nonce: bigint): string {
  return `settle:${vaultAddress}:${nonce.toString()}`;
}
