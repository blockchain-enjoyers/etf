import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "../config/config.service.js";
import { IndexerRepository } from "../indexer/indexer.repository.js";

/** Resolves vault -> ForwardCashQueue from the FORWARD_QUEUES env seed unioned with DB Live rows. */
@Injectable()
export class ForwardQueueRegistry {
  private readonly logger = new Logger(ForwardQueueRegistry.name);
  private readonly seed: Record<string, string> = {};
  private merged: Record<string, string> = {};
  private lastRefreshMs = 0;
  private readonly ttlMs = 10_000;

  constructor(config: ConfigService, private readonly repo: IndexerRepository) {
    const raw = (config.get("FORWARD_QUEUES") as string) ?? "{}";
    try { for (const [v, q] of Object.entries(JSON.parse(raw) as Record<string, string>)) this.seed[v.toLowerCase()] = q; }
    catch { this.logger.warn("FORWARD_QUEUES is not valid JSON; treating as empty"); }
    this.merged = { ...this.seed };
  }

  async refresh(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastRefreshMs < this.ttlMs) return;
    this.lastRefreshMs = now;
    const live = await this.repo.getLiveForwardQueues();
    const m: Record<string, string> = { ...this.seed };
    for (const { vault, queue } of live) m[vault.toLowerCase()] = queue;
    this.merged = m;
  }

  queueFor(vault: string): string | undefined { return this.merged[vault.toLowerCase()]; }

  pairs(): { vault: string; queue: string }[] {
    return Object.entries(this.merged).map(([vault, queue]) => ({ vault, queue }));
  }
}
