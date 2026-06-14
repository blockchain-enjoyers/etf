import { Injectable } from "@nestjs/common";
import { PayloadSignerService } from "../chain/payload-signer.service.js";

@Injectable()
export class AggSourcePayloads {
  constructor(private readonly signer: PayloadSignerService) {}

  /**
   * Per-token aggregator payloads. The signer already pads each token's signed legs to the on-chain
   * sourceCount (extra mock/read sources ignore their payload), so this just fans out over the set.
   */
  async payloadsFor(tokens: readonly `0x${string}`[]): Promise<readonly `0x${string}`[][]> {
    return Promise.all(tokens.map(async (t) => [...(await this.signer.payloadsFor(t))]));
  }
}
