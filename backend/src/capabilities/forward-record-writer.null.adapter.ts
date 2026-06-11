import { Injectable } from "@nestjs/common";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { ForwardRecordWriterPort } from "./forward-record-writer.port.js";

@Injectable()
export class NullForwardRecordWriter extends ForwardRecordWriterPort {
  async record(_vault: `0x${string}`): Promise<`0x${string}`> {
    throw new CapabilityUnavailableError("BasketNavObserver");
  }
}
