import { Injectable, Logger } from "@nestjs/common";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { RebalanceWriterPort } from "../capabilities/rebalance-writer.port.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { BasketRepository } from "../persistence/basket.repository.js";
import type { KeeperResult, RebalancePayload } from "./keeper.types.js";

/**
 * Triggers an on-chain rebalance through RebalanceWriterPort. The live adapter (v2) gates on
 * oracle freshness + Regular and calls the RebalanceEngine; the null adapter at L1 reports the
 * capability absent. The keeper stays dormant until the engine ships.
 *
 * Degrade-safe: KEEPER_ENABLED=false → noop; no walletClient → noop; basket unknown → noop;
 * writer capability absent → noop.
 */
@Injectable()
export class RebalanceService {
  private readonly logger = new Logger(RebalanceService.name);

  constructor(
    private readonly chain: ChainService,
    private readonly writer: RebalanceWriterPort,
    private readonly baskets: BasketRepository,
    private readonly config: ConfigService,
  ) {}

  async run(payload: RebalancePayload): Promise<KeeperResult> {
    if (!this.config.get("KEEPER_ENABLED")) {
      return { status: "noop", detail: "keeper disabled" };
    }

    if (!this.chain.walletClient) {
      this.logger.warn(
        "RebalanceService: walletClient absent (KEEPER_PRIVATE_KEY not set) — skipping rebalance",
      );
      return { status: "noop", detail: "no walletClient — KEEPER_PRIVATE_KEY not configured" };
    }

    const basket = await this.baskets.findReference(payload.vaultAddress);
    if (!basket) {
      return { status: "noop", detail: `basket ${payload.vaultAddress} not found` };
    }

    try {
      const txHash = await this.writer.triggerRebalance(basket.vaultAddress as `0x${string}`);
      this.logger.log(`rebalance tx ${txHash} for ${payload.vaultAddress}`);
      return { status: "submitted", txHash };
    } catch (err) {
      if (err instanceof CapabilityUnavailableError) {
        this.logger.warn(`RebalanceService dormant: ${err.message}`);
        return { status: "noop", detail: err.message };
      }
      throw err;
    }
  }
}
