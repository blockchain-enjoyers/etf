import { Global, Module, type Provider } from "@nestjs/common";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ChainService } from "../chain/chain.service.js";
import { ConfigService } from "../config/config.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { SignalRouter } from "../signals/signal-router.js";
import { BootstrapBasket } from "./basket-source.js";
import { ConfidenceService } from "./confidence.service.js";
import { NavEngineService } from "./nav-engine.service.js";
import { NavRepository } from "./nav.repository.js";
import { OnChainNavReader } from "./onchain-nav.reader.js";

const providers: Provider[] = [
  BootstrapBasket,
  NavRepository,
  OnChainNavReader,
  {
    provide: ConfidenceService,
    useFactory: (config: ConfigService) => new ConfidenceService(config.get("ESTIMATED_BAND_BPS")),
    inject: [ConfigService],
  },
  {
    provide: NavEngineService,
    useFactory: (
      router: SignalRouter,
      confidence: ConfidenceService,
      bootstrap: BootstrapBasket,
      onchain: OnChainNavReader,
      prisma: PrismaService,
      registry: CapabilityRegistry,
      config: ConfigService,
      chain: ChainService,
    ) => new NavEngineService(router, confidence, bootstrap, onchain, prisma, registry, config, chain),
    inject: [SignalRouter, ConfidenceService, BootstrapBasket, OnChainNavReader, PrismaService, CapabilityRegistry, ConfigService, ChainService],
  },
];

/**
 * NavModule owns BootstrapBasket and exports it @Global so SignalsModule can inject it
 * without creating a circular module import (neither module lists the other in `imports`).
 * Both are @Global(); Nest resolves cross-module providers via the global registry. [spec §5.3]
 */
@Global()
@Module({
  providers,
  exports: [NavEngineService, NavRepository, BootstrapBasket, ConfidenceService],
})
export class NavModule {}
