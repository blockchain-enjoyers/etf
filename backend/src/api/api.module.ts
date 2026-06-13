import { Module } from "@nestjs/common";
import { CapabilitiesModule } from "../capabilities/capabilities.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { IndexerRepository } from "../indexer/indexer.repository.js";
import { AvailabilityService } from "./availability.service.js";
import { BasketsController } from "./baskets.controller.js";
import { FeedController } from "./feed.controller.js";
import { ForwardService } from "./forward.service.js";
import { HoldingsService } from "./holdings.service.js";
import { RebalanceService } from "./rebalance.service.js";
import { ConstituentPricesController } from "./constituent-prices.controller.js";
import { AggSourcePayloads } from "./agg-source-payloads.js";
import { SceneOracleConfig } from "../demo/scene-oracle.config.js";
import { AccountsController } from "./accounts.controller.js";
import { PositionService } from "./position.service.js";
import { ActivityService } from "./activity.service.js";
import { ForwardEnableController } from "./forward-enable.controller.js";
import { ForwardEnableService } from "./forward-enable.service.js";
import { ForwardEnableAuthService } from "./forward-enable-auth.service.js";

/**
 * API read surface. Zod DTOs come from @meridian/sdk; ports (RedeemQuotePort) come from
 * CapabilitiesModule (binding chosen at boot by CapabilityRegistry). PrismaService is global.
 * ContractsModule + ChainModule are @Global() so ManagedRebalanceVaultReader, KeeperModuleReader,
 * RebalanceModuleReader, CapabilityRegistry, and ChainService are available without an explicit
 * import here.
 */
@Module({
  imports: [CapabilitiesModule, JobsModule],
  controllers: [BasketsController, FeedController, AccountsController, ForwardEnableController, ConstituentPricesController],
  providers: [AvailabilityService, RebalanceService, ForwardService, HoldingsService, AggSourcePayloads, SceneOracleConfig, IndexerRepository, PositionService, ActivityService, ForwardEnableService, ForwardEnableAuthService],
  exports: [AvailabilityService],
})
export class ApiModule {}
