/** Writer port: ForwardCashQueue.settle(ids, held, payloads, ap) + AP-filler approvals. */
export abstract class ForwardSettleWriterPort {
  abstract settle(vault: `0x${string}`, ids: bigint[], ap: `0x${string}`): Promise<`0x${string}`>;
  /** Testnet: ensure the AP filler is approved for the batch's create constituents. */
  abstract approve(vault: `0x${string}`, ap: `0x${string}`): Promise<`0x${string}`>;
}
