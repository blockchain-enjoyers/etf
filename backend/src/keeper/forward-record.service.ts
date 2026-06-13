import { Injectable, Logger } from "@nestjs/common";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { ForwardRecordWriterPort } from "../capabilities/forward-record-writer.port.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import type { KeeperResult } from "./keeper.types.js";

/**
 * Pokes BasketNavObserver.record for each configured vault to keep the navPerShare TWAP fresh.
 * record() is a no-op on-chain unless the L4 reading is Open && safe, so an over-eager poke is cheap.
 * Degrade-safe: disabled / no walletClient / capability absent => noop.
 */
@Injectable()
export class ForwardRecordService {
  private readonly logger = new Logger(ForwardRecordService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly chain: ChainService,
    private readonly forwardQueues: ForwardQueueRegistry,
    private readonly writer: ForwardRecordWriterPort,
  ) {}

  async run(): Promise<KeeperResult> {
    await this.forwardQueues.refresh();
    if (!this.config.get("FORWARD_OPERATOR_ENABLED")) {
      return { status: "noop", detail: "forward operator disabled" };
    }
    if (!this.chain.walletClient) {
      return { status: "noop", detail: "no walletClient — FORWARD_OPERATOR_PRIVATE_KEY not set" };
    }
    let poked = 0;
    for (const { vault } of this.forwardQueues.pairs()) {
      try {
        await this.writer.record(vault as `0x${string}`);
        poked += 1;
      } catch (err) {
        if (err instanceof CapabilityUnavailableError) {
          this.logger.warn(`ForwardRecordService dormant: ${err.message}`);
          return { status: "noop", detail: err.message };
        }
        this.logger.error(`forward record failed for ${vault}: ${(err as Error).message}`);
      }
    }
    if (poked === 0) return { status: "skipped", detail: "no queues to poke" };
    return { status: "submitted", detail: `poked ${poked} vault(s)` };
  }
}
