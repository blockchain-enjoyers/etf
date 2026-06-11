import { Module } from "@nestjs/common";
import { FairValueSinkPort } from "../capabilities/fair-value-sink.port.js";
import { NullFairValueSink } from "../capabilities/fair-value-sink.null.adapter.js";
import { ForwardRecordWriterPort } from "../capabilities/forward-record-writer.port.js";
import { NullForwardRecordWriter } from "../capabilities/forward-record-writer.null.adapter.js";
import { LiveForwardRecordWriter } from "../capabilities/forward-record-writer.live.adapter.js";
import { ForwardSettleWriterPort } from "../capabilities/forward-settle-writer.port.js";
import { NullForwardSettleWriter } from "../capabilities/forward-settle-writer.null.adapter.js";
import { LiveForwardSettleWriter } from "../capabilities/forward-settle-writer.live.adapter.js";
import { RebalanceWriterPort } from "../capabilities/rebalance-writer.port.js";
import { NullRebalanceWriter } from "../capabilities/rebalance-writer.null.adapter.js";
import { SettleWriterPort } from "../capabilities/settle-writer.port.js";
import { NullSettleWriter } from "../capabilities/settle-writer.null.adapter.js";
import { PayloadSignerService } from "../chain/payload-signer.service.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ManagedRebalanceVaultReader } from "../contracts/managed-rebalance-vault.reader.js";
import { IndexerRepository } from "../indexer/indexer.repository.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { AttestationService } from "./attestation.service.js";
import { ForwardApProvider } from "./forward-ap.provider.js";
import { ForwardRecordService } from "./forward-record.service.js";
import { ForwardSettleService } from "./forward-settle.service.js";
import { RebalanceService } from "./rebalance.service.js";
import { SettleService } from "./settle.service.js";
import { KeeperJobs } from "./keeper.jobs.js";

/**
 * Registers the three keeper pg-boss jobs (attestation-push, rebalance, settle) and their services.
 * The on-chain write surfaces are accessed through capability writer ports. At L1 the NAVEngine /
 * RebalanceEngine / cash-settle capabilities are absent, so every writer port binds to its null
 * adapter — the keeper boots dormant (no dead ABI imports). KEEPER_ENABLED stays the outer gate.
 *
 * ChainService, PrismaService, BasketRepository, and ConfigService are available via their @Global()
 * modules. JobsModule is imported explicitly to obtain PgBossService.
 */
@Module({
  imports: [JobsModule],
  providers: [
    AttestationService,
    RebalanceService,
    SettleService,
    ForwardRecordService,
    ForwardSettleService,
    ForwardApProvider,
    IndexerRepository,
    KeeperJobs,
    { provide: FairValueSinkPort, useClass: NullFairValueSink },
    { provide: RebalanceWriterPort, useClass: NullRebalanceWriter },
    { provide: SettleWriterPort, useClass: NullSettleWriter },
    {
      provide: ForwardRecordWriterPort,
      useFactory: (
        config: ConfigService,
        chain: ChainService,
        registry: CapabilityRegistry,
        rebVault: ManagedRebalanceVaultReader,
        signer: PayloadSignerService,
      ) =>
        registry.present("BasketNavObserver") && config.get("FORWARD_OPERATOR_PRIVATE_KEY")
          ? new LiveForwardRecordWriter(chain, registry, rebVault, signer)
          : new NullForwardRecordWriter(),
      inject: [ConfigService, ChainService, CapabilityRegistry, ManagedRebalanceVaultReader, PayloadSignerService],
    },
    {
      provide: ForwardSettleWriterPort,
      useFactory: (
        config: ConfigService,
        chain: ChainService,
        registry: CapabilityRegistry,
        rebVault: ManagedRebalanceVaultReader,
        signer: PayloadSignerService,
      ) =>
        registry.present("ForwardCashQueue") && config.get("FORWARD_OPERATOR_PRIVATE_KEY")
          ? new LiveForwardSettleWriter(chain, registry, rebVault, signer)
          : new NullForwardSettleWriter(),
      inject: [ConfigService, ChainService, CapabilityRegistry, ManagedRebalanceVaultReader, PayloadSignerService],
    },
  ],
  exports: [
    KeeperJobs,
    AttestationService,
    RebalanceService,
    SettleService,
    ForwardRecordService,
    ForwardSettleService,
    ForwardApProvider,
  ],
})
export class KeeperModule {}
