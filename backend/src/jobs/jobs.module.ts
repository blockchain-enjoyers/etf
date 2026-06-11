import { Module, type OnModuleInit } from "@nestjs/common";
import { IndexerModule } from "../indexer/indexer.module.js";
import { NavModule } from "../nav/nav.module.js";
import { SignalsModule } from "../signals/signals.module.js";
import {
  CRON_INDEXER_TICK,
  CRON_NAV_COMPUTE,
  CRON_SIGNAL_POLL,
  CRON_TWAP_RECORD,
  JOB_INDEXER_TICK,
  JOB_NAV_COMPUTE,
  JOB_SIGNAL_POLL,
  JOB_TWAP_RECORD,
} from "./jobs.constants.js";
import { IndexerTickHandler } from "./indexer-tick.handler.js";
import { NavComputeHandler } from "./nav-compute.handler.js";
import { TwapRecordHandler } from "./twap-record.handler.js";
import { PgBossService } from "./pg-boss.service.js";
import { SignalPollHandler } from "./signal-poll.handler.js";

/**
 * Producer role (spec §3). Registers the producer jobs as cron schedules with
 * singletonKey (exactly one runs at a time across replicas) and binds their worker
 * handlers. nav-compute fans out over every indexed basket (NavComputeHandler.runAll),
 * so NAV/history populate for all deployed vaults — not just a single bootstrap id.
 */
@Module({
  imports: [NavModule, SignalsModule, IndexerModule],
  providers: [
    PgBossService,
    NavComputeHandler,
    SignalPollHandler,
    IndexerTickHandler,
    TwapRecordHandler,
  ],
  exports: [PgBossService],
})
export class JobsModule implements OnModuleInit {
  constructor(
    private readonly boss: PgBossService,
    private readonly navCompute: NavComputeHandler,
    private readonly signalPoll: SignalPollHandler,
    private readonly indexerTick: IndexerTickHandler,
    private readonly twapRecord: TwapRecordHandler,
  ) {}

  async onModuleInit(): Promise<void> {
    // pg-boss 12 requires queues to exist before schedule() / work() calls.
    await this.boss.createQueue(JOB_SIGNAL_POLL);
    await this.boss.createQueue(JOB_NAV_COMPUTE);
    await this.boss.createQueue(JOB_INDEXER_TICK);
    await this.boss.createQueue(JOB_TWAP_RECORD);

    await this.boss.work(JOB_SIGNAL_POLL, async () => {
      await this.signalPoll.run();
    });
    // Compute NAV for EVERY indexed basket (not just a single bootstrap id) so the chart/NAV
    // populate for all deployed vaults; per-vault errors are isolated inside runAll().
    await this.boss.work(JOB_NAV_COMPUTE, async () => {
      await this.navCompute.runAll();
    });
    await this.boss.work(JOB_INDEXER_TICK, async () => {
      await this.indexerTick.run();
    });
    await this.boss.work(JOB_TWAP_RECORD, async () => {
      await this.twapRecord.run();
    });

    await this.boss.scheduleSingleton(JOB_SIGNAL_POLL, CRON_SIGNAL_POLL);
    await this.boss.scheduleSingleton(JOB_NAV_COMPUTE, CRON_NAV_COMPUTE);
    await this.boss.scheduleSingleton(JOB_INDEXER_TICK, CRON_INDEXER_TICK);
    await this.boss.scheduleSingleton(JOB_TWAP_RECORD, CRON_TWAP_RECORD);
  }
}
