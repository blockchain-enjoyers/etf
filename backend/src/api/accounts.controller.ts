import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { AccountHoldingsResponse, ForwardTicket, ActivityEvent } from "@meridian/sdk";
import { PositionService } from "./position.service.js";
import { ForwardService } from "./forward.service.js";
import { ActivityService } from "./activity.service.js";

@ApiTags("accounts")
@Controller("accounts")
export class AccountsController {
  constructor(
    private readonly positions: PositionService,
    private readonly forward: ForwardService,
    private readonly activity: ActivityService,
  ) {}

  @Get(":address/holdings")
  @ApiOperation({ summary: "Per-account basket holdings, valued at latest NAV" })
  @ApiParam({ name: "address", description: "owner address (0x)" })
  getHoldings(@Param("address") address: string): Promise<AccountHoldingsResponse> {
    return this.positions.accountHoldings(address);
  }

  @Get(":address/forward-tickets")
  @ApiOperation({ summary: "Open forward-queue tickets for an account across all vaults" })
  @ApiParam({ name: "address", description: "owner address (0x)" })
  getForwardTickets(@Param("address") address: string): Promise<ForwardTicket[]> {
    return this.forward.getAccountTickets(address);
  }

  @Get(":address/activity")
  @ApiOperation({ summary: "Per-account activity feed (mint/redeem + forward lifecycle), newest first" })
  @ApiParam({ name: "address", description: "owner address (0x)" })
  getActivity(@Param("address") address: string): Promise<ActivityEvent[]> {
    return this.activity.getAccountActivity(address);
  }
}
