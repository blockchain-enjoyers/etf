import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { SuggestedFundsResponse } from "@meridian/sdk";
import { SuggestedFundsService } from "./suggested-funds.service.js";

@ApiTags("catalog")
@Controller("catalog")
export class CatalogController {
  constructor(private readonly suggestedFunds: SuggestedFundsService) {}

  @Get("suggested-funds")
  @ApiOperation({ summary: "Real-ETF-replica fund templates for the create-flow recommender" })
  suggestedFundsCatalog(): SuggestedFundsResponse {
    return this.suggestedFunds.get();
  }
}
