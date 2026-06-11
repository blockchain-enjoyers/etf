import { Injectable } from "@nestjs/common";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { FairValueSinkPort } from "./fair-value-sink.port.js";

@Injectable()
export class NullFairValueSink extends FairValueSinkPort {
  push(): Promise<`0x${string}`> {
    throw new CapabilityUnavailableError("FairValueNAV");
  }
}
