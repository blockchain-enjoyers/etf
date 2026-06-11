import { Global, Module } from "@nestjs/common";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { CloneFactoryReader } from "./clone-factory.reader.js";
import { BasketVaultReader } from "./basket-vault.reader.js";
import { ManagedRebalanceVaultReader } from "./managed-rebalance-vault.reader.js";
import { KeeperModuleReader } from "./keeper-module.reader.js";
import { RebalanceModuleReader } from "./rebalance-module.reader.js";
import { ForwardCashQueueReader } from "./forward-cash-queue.reader.js";
import { BasketNavObserverReader } from "./basket-nav-observer.reader.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { ForwardQueueRegistry } from "./forward-queue-registry.js";
import { TokenMetadataService } from "./token-metadata.service.js";

@Global()
@Module({
  providers: [
    BasketVaultReader,
    CloneFactoryReader,
    ManagedRebalanceVaultReader,
    KeeperModuleReader,
    RebalanceModuleReader,
    ForwardCashQueueReader,
    BasketNavObserverReader,
    ForwardQueueRegistry,
    TokenMetadataService,
    {
      provide: CapabilityRegistry,
      useFactory: (config: ConfigService, chain: ChainService) =>
        CapabilityRegistry.create(config, chain),
      inject: [ConfigService, ChainService],
    },
  ],
  exports: [
    BasketVaultReader,
    CloneFactoryReader,
    ManagedRebalanceVaultReader,
    KeeperModuleReader,
    RebalanceModuleReader,
    ForwardCashQueueReader,
    BasketNavObserverReader,
    ForwardQueueRegistry,
    TokenMetadataService,
    CapabilityRegistry,
  ],
})
export class ContractsModule {}
