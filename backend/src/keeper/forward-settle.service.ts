import { Injectable, Logger } from "@nestjs/common";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { ForwardSettleWriterPort } from "../capabilities/forward-settle-writer.port.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { IndexerRepository } from "../indexer/indexer.repository.js";
import { ForwardApProvider } from "./forward-ap.provider.js";
import type { KeeperResult } from "./keeper.types.js";

interface PendingTicket {
  ticketId: number;
  cutoff: Date;
  kind: "Create" | "Redeem";
  remaining: { toFixed(n: number): string };
}

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
    private readonly rebVault: ManagedRebalanceVaultReader,
  ) {}

  async run(): Promise<KeeperResult> {
    await this.forwardQueues.refresh();
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
    let foundBatches = 0; // queues that HAD past-cutoff tickets to settle this pass
    let lastError: string | undefined;
    for (const { vault } of this.forwardQueues.pairs()) {
      const pending = (await this.repo.getPendingForwardTickets(vault)) as PendingTicket[];
      const pastCutoff = pending.filter((t) => t.cutoff.getTime() <= now);
      if (pastCutoff.length === 0) continue;
      // Drop create tickets that can never settle: a deposit <= the fixed flatCreateFee mints 0 shares
      // (ZeroShares revert) and, being past cutoff, can't be cancelled either — so the keeper would retry
      // it forever. Read the fee once; default 0 (managed / no-fee seam) so nothing is dropped there.
      let fee = 0n;
      try {
        fee = await this.rebVault.flatCreateFee(vault as `0x${string}`);
      } catch {
        /* no flat-fee surface (managed vault) — keep all tickets */
      }
      const live = pastCutoff.filter(
        (t) => !(t.kind === "Create" && BigInt(t.remaining.toFixed(0)) <= fee),
      );
      const dropped = pastCutoff.length - live.length;
      if (dropped > 0) {
        this.logger.warn(`skipping ${dropped} unsettleable create ticket(s) on ${vault} (cash <= flatCreateFee)`);
      }
      const ids = live.map((t) => BigInt(t.ticketId));
      if (ids.length === 0) continue;
      foundBatches += 1;
      try {
        await this.ap.prepare(vault, ids); // testnet: fund+approve the AP filler; noop when dormant
        lastTx = await this.writer.settle(vault as `0x${string}`, ids, ap);
        settledBatches += 1;
      } catch (err) {
        if (err instanceof CapabilityUnavailableError) {
          this.logger.warn(`ForwardSettleService dormant: ${err.message}`);
          return { status: "noop", detail: err.message };
        }
        lastError = (err as Error).message;
        this.logger.error(`forward settle failed for ${vault}: ${lastError}`);
      }
    }
    if (settledBatches > 0) {
      return { status: "submitted", txHash: lastTx, detail: `settled ${settledBatches} batch(es)` };
    }
    // Distinguish "nothing to do" from "had tickets but every settle reverted" — the latter is the
    // real signal (gate not open / oracle), and was previously masked as "skipped: no past-cutoff".
    if (foundBatches === 0) {
      return { status: "skipped", detail: "no past-cutoff tickets" };
    }
    return { status: "failed", detail: lastError ?? `all ${foundBatches} settle attempt(s) reverted` };
  }
}
