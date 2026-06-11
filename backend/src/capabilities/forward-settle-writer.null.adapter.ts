import { Injectable } from "@nestjs/common";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { ForwardSettleWriterPort } from "./forward-settle-writer.port.js";

@Injectable()
export class NullForwardSettleWriter extends ForwardSettleWriterPort {
  async settle(
    _vault: `0x${string}`,
    _ids: bigint[],
    _ap: `0x${string}`,
  ): Promise<`0x${string}`> {
    throw new CapabilityUnavailableError("ForwardCashQueue");
  }

  approve(): Promise<`0x${string}`> {
    throw new CapabilityUnavailableError("ForwardCashQueue");
  }
}
