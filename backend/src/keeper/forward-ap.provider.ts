import { Injectable, Logger } from "@nestjs/common";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { ForwardSettleWriterPort } from "../capabilities/forward-settle-writer.port.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import type { KeeperResult } from "./keeper.types.js";

/**
 * AP inventory provider. Testnet: ensures the MockAPFiller is funded + approved for the batch before
 * settle (the operator drives it as the AP). Production DEX/CEX sourcing is OUT OF SCOPE (flagged).
 * Degrade-safe: disabled / no walletClient / no AP filler / capability absent => noop.
 */
@Injectable()
export class ForwardApProvider {
  private readonly logger = new Logger(ForwardApProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly chain: ChainService,
    private readonly writer: ForwardSettleWriterPort,
  ) {}

  async prepare(vault: string, ids: bigint[]): Promise<KeeperResult> {
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
    if (ids.length === 0) {
      return { status: "skipped", detail: "no tickets to prepare" };
    }
    try {
      const txHash = await this.writer.approve(vault as `0x${string}`, ap);
      return { status: "submitted", txHash, detail: `prepared AP for ${ids.length} ticket(s)` };
    } catch (err) {
      if (err instanceof CapabilityUnavailableError) {
        this.logger.warn(`ForwardApProvider dormant: ${err.message}`);
        return { status: "noop", detail: err.message };
      }
      throw err;
    }
  }
}
