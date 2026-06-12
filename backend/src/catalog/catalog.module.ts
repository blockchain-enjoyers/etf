import { Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller.js";
import { SuggestedFundsService } from "./suggested-funds.service.js";

/** Static reference catalog (suggested-funds templates). File-backed, offline — no chain, no DB. */
@Module({
  providers: [SuggestedFundsService],
  controllers: [CatalogController],
})
export class CatalogModule {}
