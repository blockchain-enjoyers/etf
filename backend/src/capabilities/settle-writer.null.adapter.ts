import { Injectable } from "@nestjs/common";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { SettleWriterPort } from "./settle-writer.port.js";

@Injectable()
export class NullSettleWriter extends SettleWriterPort {
  settle(): Promise<`0x${string}`> {
    throw new CapabilityUnavailableError("RebalanceModule");
  }
}
