import { Injectable, Logger } from "@nestjs/common";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { ForwardSettleWriterPort } from "../capabilities/forward-settle-writer.port.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import { IndexerRepository } from "../indexer/indexer.repository.js";
import { ForwardApProvider } from "./forward-ap.provider.js";
import type { KeeperResult } from "./keeper.types.js";

/**
 * Settles past-cutoff forward tickets for every configured queue. The settle writer runs the gate
 * once on-chain and reverts the whole batch if not open, so this only needs to pick past-cutoff ids.
 * Degrade-safe: disabled / no walletClient / no AP filler / capability absent => noop.
 */
@Injectable()
export class ForwardSettleService {
  private readonly logger = new Logger(ForwardSettleService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly chain: ChainService,
    private readonly repo: IndexerRepository,
    private readonly forwardQueues: ForwardQueueRegistry,
    private readonly writer: ForwardSettleWriterPort,
    private readonly ap: ForwardApProvider,
  ) {}

  async run(): Promise<KeeperResult> {
    if (!this.config.get("FORWARD_OPERATOR_ENABLED")) {
      return { status: "noop", detail: "forward operator disabled" };
    }
    if (!this.chain.walletClient) {
      return { status: "noop", detail: "no walletClient — FORWARD_OPERATOR_PRIVATE_KEY not set" };
    }
    const ap = this.config.get("FORWARD_AP_FILLER_ADDRESS") as `0x${string}` | undefined;
    if (!ap) {
      return { status: "noop", detail: "no AP filler — FORWARD_AP_FILLER_ADDRESS not set" };
    }

    const now = Date.now();
    let lastTx: `0x${string}` | undefined;
    let settledBatches = 0;
    for (const { vault } of this.forwardQueues.pairs()) {
      const pending = (await this.repo.getPendingForwardTickets(vault)) as {
        ticketId: number;
        cutoff: Date;
      }[];
      const ids = pending.filter((t) => t.cutoff.getTime() <= now).map((t) => BigInt(t.ticketId));
      if (ids.length === 0) continue;
      try {
        await this.ap.prepare(vault, ids); // testnet: fund+approve the AP filler; noop when dormant
        lastTx = await this.writer.settle(vault as `0x${string}`, ids, ap);
        settledBatches += 1;
      } catch (err) {
        if (err instanceof CapabilityUnavailableError) {
          this.logger.warn(`ForwardSettleService dormant: ${err.message}`);
          return { status: "noop", detail: err.message };
        }
        this.logger.error(`forward settle failed for ${vault}: ${(err as Error).message}`);
      }
    }
    if (settledBatches === 0) {
      return { status: "skipped", detail: "no past-cutoff tickets" };
    }
    return { status: "submitted", txHash: lastTx, detail: `settled ${settledBatches} batch(es)` };
  }
}
