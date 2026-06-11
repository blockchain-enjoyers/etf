export interface QuoteAsset {
  token: `0x${string}`;
  amount: bigint;
}

export abstract class RedeemQuotePort {
  abstract quote(vault: `0x${string}`, amount: bigint): Promise<QuoteAsset[]>;
}
