import { type QuoteAsset, RedeemQuotePort } from "./redeem-quote.port.js";

export class MockRedeemQuoteAdapter extends RedeemQuotePort {
  constructor(private readonly assets: QuoteAsset[] = []) {
    super();
  }

  async quote(_vault: `0x${string}`, _amount: bigint): Promise<QuoteAsset[]> {
    return this.assets;
  }
}
