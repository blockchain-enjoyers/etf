import type { QuoteAsset } from "../redeem-quote/redeem-quote.port.js";

export abstract class CreateQuotePort {
  abstract quote(vault: `0x${string}`, nUnits: bigint): Promise<QuoteAsset[]>;
}
