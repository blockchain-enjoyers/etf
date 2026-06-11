import { Module } from "@nestjs/common";
import { BasketVaultReader } from "../contracts/basket-vault.reader.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { ChainService } from "../chain/chain.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { CreateQuotePort } from "./create-quote/create-quote.port.js";
import { LiveCreateQuoteAdapter } from "./create-quote/create-quote.live.adapter.js";
import { NullCreateQuoteAdapter } from "./create-quote/create-quote.null.adapter.js";
import { LiveRedeemQuoteAdapter } from "./redeem-quote/redeem-quote.live.adapter.js";
import { NullRedeemQuoteAdapter } from "./redeem-quote/redeem-quote.null.adapter.js";
import { RedeemQuotePort } from "./redeem-quote/redeem-quote.port.js";

@Module({
  providers: [
    {
      provide: RedeemQuotePort,
      useFactory: (
        registry: CapabilityRegistry,
        vault: BasketVaultReader,
        prisma: PrismaService,
        chain: ChainService,
      ): RedeemQuotePort =>
        registry.status("BasketVault") === "live"
          ? new LiveRedeemQuoteAdapter(vault, prisma, chain)
          : new NullRedeemQuoteAdapter(),
      inject: [CapabilityRegistry, BasketVaultReader, PrismaService, ChainService],
    },
    {
      provide: CreateQuotePort,
      useFactory: (registry: CapabilityRegistry, vault: BasketVaultReader, prisma: PrismaService): CreateQuotePort =>
        registry.status("BasketVault") === "live"
          ? new LiveCreateQuoteAdapter(vault, prisma)
          : new NullCreateQuoteAdapter(),
      inject: [CapabilityRegistry, BasketVaultReader, PrismaService],
    },
  ],
  exports: [RedeemQuotePort, CreateQuotePort],
})
export class CapabilitiesModule {}
