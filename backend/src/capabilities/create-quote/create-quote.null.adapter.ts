import { Injectable } from "@nestjs/common";
import { CapabilityUnavailableError } from "../capability-unavailable.error.js";
import type { QuoteAsset } from "../redeem-quote/redeem-quote.port.js";
import { CreateQuotePort } from "./create-quote.port.js";

@Injectable()
export class NullCreateQuoteAdapter extends CreateQuotePort {
  async quote(_vault: `0x${string}`, _nUnits: bigint): Promise<QuoteAsset[]> {
    throw new CapabilityUnavailableError("BasketVault");
  }
}
