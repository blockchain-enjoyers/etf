import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { AccountHoldingsResponse } from "@meridian/sdk";
import { PositionService } from "./position.service.js";

@ApiTags("accounts")
@Controller("accounts")
export class AccountsController {
  constructor(private readonly positions: PositionService) {}

  @Get(":address/holdings")
  @ApiOperation({ summary: "Per-account basket holdings, valued at latest NAV" })
  @ApiParam({ name: "address", description: "owner address (0x)" })
  getHoldings(@Param("address") address: string): Promise<AccountHoldingsResponse> {
    return this.positions.accountHoldings(address);
  }
}
