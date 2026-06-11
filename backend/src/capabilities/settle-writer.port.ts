/**
 * Writer port for settling one forward-queue entry on reopen
 * (CreationRedemption.settleQueued in v2). At L1 the cash-settle rail is absent, so the binding
 * selects the null adapter and every call throws CapabilityUnavailableError.
 */
export abstract class SettleWriterPort {
  abstract settle(vault: `0x${string}`, owner: `0x${string}`, nonce: bigint): Promise<`0x${string}`>;
}
