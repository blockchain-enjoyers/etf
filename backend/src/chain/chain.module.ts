import { Global, Module } from "@nestjs/common";
import { PrismaService } from "../persistence/prisma.service.js";
import { ChainService } from "./chain.service.js";
import { PayloadSignerService } from "./payload-signer.service.js";

@Global()
@Module({
  providers: [
    ChainService,
    {
      provide: PayloadSignerService,
      useFactory: (prisma: PrismaService, chain: ChainService) =>
        new PayloadSignerService(prisma, chain, {
          depth: 5_000_000n * 10n ** 18n,
          nowSec: () => Math.floor(Date.now() / 1000),
          // Testnet demo: force the weekday leg live so Open NAV is verifiable outside US market hours.
          forceOpen: () => process.env.MARKET_FORCE_OPEN === "true",
        }),
      inject: [PrismaService, ChainService],
    },
  ],
  exports: [ChainService, PayloadSignerService],
})
export class ChainModule {}
