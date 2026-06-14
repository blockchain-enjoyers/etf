import { Injectable, Logger } from "@nestjs/common";
import { ForwardCashQueueAbi } from "@meridian/contracts";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { ForwardRecordWriterPort } from "../capabilities/forward-record-writer.port.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import type { KeeperResult } from "./keeper.types.js";

// MockPegFeed.setUpdatedAt — the g8 peg gate checks block.timestamp - updatedAt <= pegMaxAge. The testnet
// mock feed has no real Chainlink updater, so the keeper refreshes its timestamp each cycle or settle PegStale's.
const PEG_ABI = [
  { type: "function", name: "setUpdatedAt", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
] as const;

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
    const pairs = this.forwardQueues.pairs();
    let poked = 0;
    for (const { vault } of pairs) {
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
    await this.refreshPegFeeds(pairs.map((p) => p.queue));
    if (poked === 0) return { status: "skipped", detail: "no queues to poke" };
    return { status: "submitted", detail: `poked ${poked} vault(s)` };
  }

  /** Keep the g8 peg gate fresh: poke each queue's (shared) MockPegFeed updatedAt to now. Best-effort. */
  private async refreshPegFeeds(queues: string[]): Promise<void> {
    const wallet = this.chain.walletClient;
    if (!wallet || queues.length === 0) return;
    const feeds = new Set<string>();
    for (const queue of queues) {
      try {
        const feed = (await this.chain.publicClient.readContract({
          address: queue as `0x${string}`,
          abi: ForwardCashQueueAbi,
          functionName: "pegFeed",
        })) as `0x${string}`;
        if (feed && feed !== "0x0000000000000000000000000000000000000000") feeds.add(feed.toLowerCase());
      } catch {
        // queue without a pegFeed getter (older deploy) — skip.
      }
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const feed of feeds) {
      try {
        await wallet.writeContract({
          chain: this.chain.chain,
          account: this.chain.account!,
          address: feed as `0x${string}`,
          abi: PEG_ABI,
          functionName: "setUpdatedAt",
          args: [now],
        } as never);
      } catch (err) {
        this.logger.warn(`peg refresh failed for ${feed}: ${(err as Error).message}`);
      }
    }
  }
}
