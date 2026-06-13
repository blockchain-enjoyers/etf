import { Injectable } from "@nestjs/common";
import { validateEnableParams, type EnableParams } from "./forward-enable.params.js";
import { ForwardEnableAuthService } from "./forward-enable-auth.service.js";
import { IndexerRepository } from "../indexer/indexer.repository.js";
import { PgBossService } from "../jobs/pg-boss.service.js";
import { JOB_FORWARD_ENABLE } from "../jobs/jobs.constants.js";

export class ForwardEnableBadParam extends Error {}
export class ForwardEnableConflict extends Error {}

@Injectable()
export class ForwardEnableService {
  constructor(
    private readonly repo: IndexerRepository,
    private readonly auth: ForwardEnableAuthService,
    private readonly boss: PgBossService,
  ) {}

  async enable(
    vault: string,
    params: EnableParams,
    sig: { nonce: string; expiry: number; signature: `0x${string}` },
  ) {
    const v = validateEnableParams(params);
    if (!v.ok) throw new ForwardEnableBadParam(`param out of bounds: ${v.field}`);
    const existing = await this.repo.getForwardQueueConfig(vault);
    if (existing && (existing.status === "Live" || existing.status === "Wiring"))
      throw new ForwardEnableConflict(`already ${existing.status}`);
    const requestedBy = await this.auth.verify(vault, params, sig);
    await this.repo.upsertForwardQueueConfig({ vaultAddress: vault, requestedBy, params });
    await this.boss.send(JOB_FORWARD_ENABLE, { vault });
    return { status: "pending" as const };
  }

  async status(vault: string) {
    const r = await this.repo.getForwardQueueConfig(vault);
    if (!r) return { status: "none" as const };
    return {
      status: r.status.toLowerCase() as "pending" | "wiring" | "live" | "failed",
      step: r.step ?? undefined,
      queueAddress: r.queueAddress ?? undefined,
      error: r.error ?? undefined,
    };
  }
}
