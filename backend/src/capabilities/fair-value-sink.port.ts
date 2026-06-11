/**
 * Sink for pushing a stored, off-chain-fitted fair-value attestation on-chain
 * (NAVEngine.setFairValueAttestation in v2). Off-chain EIP-712 ingest + storage (FairValueService)
 * is unaffected by this port — only the on-chain push goes through it. At L1 the NAVEngine
 * capability is absent, so the binding selects null and push throws CapabilityUnavailableError.
 */
export interface FairValueAttestationPush {
  vault: `0x${string}`;
  nav: bigint;
  confidenceLower: bigint;
  confidenceUpper: bigint;
  timestamp: bigint;
  signature: `0x${string}`;
}

export abstract class FairValueSinkPort {
  abstract push(attestation: FairValueAttestationPush): Promise<`0x${string}`>;
}
