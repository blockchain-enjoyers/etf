import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "../config/config.service.js";
import { PgBossService } from "../jobs/pg-boss.service.js";
import { ForwardRecordService } from "./forward-record.service.js";
import { ForwardSettleService } from "./forward-settle.service.js";
import { RebalanceService } from "./rebalance.service.js";
import { SettleService } from "./settle.service.js";
import { rebalanceKey } from "./idempotency.js";
import {
  KEEPER_JOBS,
  type RebalancePayload,
  type SettlePayload,
} from "./keeper.types.js";

const RETRY = { retryLimit: 5, retryBackoff: true } as const;

@Injectable()
export class KeeperJobs implements OnModuleInit {
  private readonly logger = new Logger(KeeperJobs.name);

  constructor(
    private readonly pgboss: PgBossService,
    private readonly rebalance: RebalanceService,
    private readonly settle: SettleService,
    private readonly forwardRecord: ForwardRecordService,
    private readonly forwardSettle: ForwardSettleService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.config.get("KEEPER_ENABLED") as boolean;

    if (!enabled) {
      this.logger.warn("keeper disabled — jobs registered as no-op workers only");
    }

    // pg-boss 12 requires createQueue before work() / send() calls.
    await this.pgboss.createQueue(KEEPER_JOBS.rebalance);
    await this.pgboss.createQueue(KEEPER_JOBS.settle);

    await this.pgboss.work(KEEPER_JOBS.rebalance, async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const data = job.data as RebalancePayload;
      const res = await this.rebalance.run(data);
      this.logger.log(`rebalance ${data.vaultAddress}: ${res.status} ${res.txHash ?? ""}`);
    });

    await this.pgboss.work(KEEPER_JOBS.settle, async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const data = job.data as SettlePayload;
      const res = await this.settle.run(data);
      this.logger.log(`settle ${data.vaultAddress}: ${res.status} ${res.txHash ?? ""}`);
    });

    await this.pgboss.createQueue(KEEPER_JOBS.forwardRecord);
    await this.pgboss.createQueue(KEEPER_JOBS.forwardSettle);

    await this.pgboss.work(KEEPER_JOBS.forwardRecord, async () => {
      const res = await this.forwardRecord.run();
      this.logger.log(`forward-record: ${res.status} ${res.detail ?? ""}`);
    });
    await this.pgboss.work(KEEPER_JOBS.forwardSettle, async () => {
      const res = await this.forwardSettle.run();
      this.logger.log(`forward-settle: ${res.status} ${res.txHash ?? ""}`);
    });

    const forwardEnabled = this.config.get("FORWARD_OPERATOR_ENABLED") as boolean;
    if (forwardEnabled) {
      await this.pgboss.scheduleSingleton(KEEPER_JOBS.forwardRecord, "*/30 * * * * *");
      await this.pgboss.scheduleSingleton(KEEPER_JOBS.forwardSettle, "*/60 * * * * *");
    }
  }

  /** Producer: enqueue a rebalance (one per vault per UTC day). */
  async enqueueRebalance(payload: RebalancePayload): Promise<string | null> {
    return this.pgboss.send(KEEPER_JOBS.rebalance, payload, {
      singletonKey: rebalanceKey(payload.vaultAddress),
      ...RETRY,
    });
  }

  /** Producer: enqueue a forward-queue settle pass (one in-flight per vault). */
  async enqueueSettle(payload: SettlePayload): Promise<string | null> {
    return this.pgboss.send(KEEPER_JOBS.settle, payload, {
      singletonKey: `settle-pass:${payload.vaultAddress}`,
      ...RETRY,
    });
  }
}
