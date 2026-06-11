import { Injectable } from "@nestjs/common";
import { CapabilityUnavailableError } from "../capability-unavailable.error.js";
import { type QuoteAsset, RedeemQuotePort } from "./redeem-quote.port.js";

@Injectable()
export class NullRedeemQuoteAdapter extends RedeemQuotePort {
  async quote(_vault: `0x${string}`, _amount: bigint): Promise<QuoteAsset[]> {
    throw new CapabilityUnavailableError("BasketVault");
  }
}
