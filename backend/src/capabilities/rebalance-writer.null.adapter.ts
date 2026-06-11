import { Injectable } from "@nestjs/common";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { RebalanceWriterPort } from "./rebalance-writer.port.js";

@Injectable()
export class NullRebalanceWriter extends RebalanceWriterPort {
  triggerRebalance(): Promise<`0x${string}`> {
    throw new CapabilityUnavailableError("RebalanceModule");
  }
}
