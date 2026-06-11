import { Injectable } from "@nestjs/common";
import { PayloadSignerService } from "../chain/payload-signer.service.js";

@Injectable()
export class AggSourcePayloads {
  constructor(private readonly signer: PayloadSignerService) {}

  /** Per token: [weekdayPayload, weekendPayload] from the signer (length 2, matching registered source order). */
  async payloadsFor(tokens: readonly `0x${string}`[]): Promise<readonly `0x${string}`[][]> {
    return Promise.all(tokens.map((t) => this.signer.payloadsFor(t)));
  }
}
