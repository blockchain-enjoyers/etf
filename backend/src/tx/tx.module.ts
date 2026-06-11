import { Module } from "@nestjs/common";
import { ApiModule } from "../api/api.module.js";
import { TxPlanBuilder } from "./tx-plan.builder.js";
import { TxController } from "./tx.controller.js";
import { TxSimulator } from "./tx-simulator.js";
import { PreviewDeployService } from "./preview-deploy.service.js";
import { AuctionStatusService } from "../api/auction-status.service.js";

/**
 * Transaction-building surface. ContractsModule/ChainModule are @Global (ChainService,
 * CapabilityRegistry, TokenMetadataService) and Prisma/Config are global, so only ApiModule
 * (which exports AvailabilityService) needs importing.
 */
@Module({
  imports: [ApiModule],
  providers: [TxPlanBuilder, TxSimulator, AuctionStatusService, PreviewDeployService],
  controllers: [TxController],
})
export class TxModule {}
