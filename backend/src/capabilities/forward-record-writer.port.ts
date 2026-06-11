/** Writer port: poke BasketNavObserver.record(vault, held, payloads) during market-open. */
export abstract class ForwardRecordWriterPort {
  abstract record(vault: `0x${string}`): Promise<`0x${string}`>;
}
