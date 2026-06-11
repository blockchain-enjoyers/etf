import type { QuoteAsset } from "../redeem-quote/redeem-quote.port.js";
import { CreateQuotePort } from "./create-quote.port.js";

export class MockCreateQuoteAdapter extends CreateQuotePort {
  constructor(private readonly assets: QuoteAsset[] = []) {
    super();
  }

  async quote(_vault: `0x${string}`, _nUnits: bigint): Promise<QuoteAsset[]> {
    return this.assets;
  }
}
