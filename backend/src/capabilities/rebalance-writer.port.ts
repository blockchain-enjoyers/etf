/**
 * Writer port for triggering an on-chain rebalance. Live adapter lands in the RebalanceEngine
 * vertical slice (v2). At L1 the RebalanceEngine capability is absent, so the binding selects the
 * null adapter and every call throws CapabilityUnavailableError.
 */
export abstract class RebalanceWriterPort {
  abstract triggerRebalance(vault: `0x${string}`): Promise<`0x${string}`>;
}
