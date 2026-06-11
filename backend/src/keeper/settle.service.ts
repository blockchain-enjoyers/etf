import { Injectable, Logger } from "@nestjs/common";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { SettleWriterPort } from "../capabilities/settle-writer.port.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import type { KeeperResult, SettlePayload } from "./keeper.types.js";

/**
 * Walks Pending QueueEntry rows for a vault, settles each through SettleWriterPort, and flips the
 * row to Settled. Idempotent: only Pending rows are selected, so a retry is a no-op once Settled.
 *
 * Degrade-safe: KEEPER_ENABLED=false → noop; no walletClient → noop; basket unknown → noop;
 * writer capability absent → noop (rows untouched — capability-absent is not an entry failure).
 * A per-entry tx error (live adapter) flips just that entry to Failed and continues.
 */
@Injectable()
export class SettleService {
  private readonly logger = new Logger(SettleService.name);

  constructor(
    private readonly chain: ChainService,
    private readonly writer: SettleWriterPort,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async run(payload: SettlePayload): Promise<KeeperResult> {
    if (!this.config.get("KEEPER_ENABLED")) {
      return { status: "noop", detail: "keeper disabled" };
    }

    if (!this.chain.walletClient) {
      this.logger.warn(
        "SettleService: walletClient absent (KEEPER_PRIVATE_KEY not set) — skipping settle",
      );
      return { status: "noop", detail: "no walletClient — KEEPER_PRIVATE_KEY not configured" };
    }

    const pending = await this.prisma.queueEntry.findMany({
      where: { vaultAddress: payload.vaultAddress, status: "Pending" },
      orderBy: { submittedAt: "asc" },
      ...(payload.limit !== undefined ? { take: payload.limit } : {}),
    });
    if (pending.length === 0) {
      return { status: "skipped", detail: "no pending entries" };
    }

    const basket = await this.prisma.basket.findUnique({
      where: { vaultAddress: payload.vaultAddress },
    });
    if (!basket) {
      return { status: "noop", detail: `basket ${payload.vaultAddress} not found` };
    }

    let lastTx: `0x${string}` | undefined;
    let settled = 0;
    for (const entry of pending) {
      try {
        const txHash = await this.writer.settle(
          basket.vaultAddress as `0x${string}`,
          entry.owner as `0x${string}`,
          entry.nonce,
        );
        await this.prisma.queueEntry.update({
          where: { id: entry.id },
          data: { status: "Settled", settledTxHash: txHash, settledAt: new Date() },
        });
        lastTx = txHash;
        settled += 1;
      } catch (err) {
        if (err instanceof CapabilityUnavailableError) {
          this.logger.warn(`SettleService dormant: ${err.message}`);
          return { status: "noop", detail: err.message };
        }
        await this.prisma.queueEntry.update({
          where: { id: entry.id },
          data: { status: "Failed" },
        });
        this.logger.error(
          `settle failed for ${payload.vaultAddress} nonce ${entry.nonce}: ${(err as Error).message}`,
        );
      }
    }

    if (settled === 0) {
      return { status: "skipped", detail: "no entries settled (all failed)" };
    }
    this.logger.log(`settled ${settled} entries for ${payload.vaultAddress}`);
    return { status: "submitted", txHash: lastTx, detail: `settled ${settled}` };
  }
}
