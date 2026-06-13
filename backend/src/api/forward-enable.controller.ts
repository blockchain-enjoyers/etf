import { Body, Controller, Get, Param, Post, ConflictException, BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { EnableRequest, ForwardEnableStatus } from "@meridian/sdk";
import { ForwardEnableService, ForwardEnableBadParam, ForwardEnableConflict } from "./forward-enable.service.js";
import { ForwardEnableAuthError } from "./forward-enable-auth.service.js";

@Controller("baskets")
export class ForwardEnableController {
  constructor(private readonly svc: ForwardEnableService) {}

  @Post(":id/forward/enable")
  async enable(@Param("id") id: string, @Body() body: EnableRequest) {
    try {
      return await this.svc.enable(id, body.params, { nonce: body.nonce, expiry: body.expiry, signature: body.signature as `0x${string}` });
    } catch (e) {
      if (e instanceof ForwardEnableBadParam) throw new BadRequestException(e.message);
      if (e instanceof ForwardEnableConflict) throw new ConflictException(e.message);
      if (e instanceof ForwardEnableAuthError) throw new UnauthorizedException(e.message);
      throw e;
    }
  }

  @Get(":id/forward/enable/status")
  status(@Param("id") id: string): Promise<ForwardEnableStatus> {
    return this.svc.status(id);
  }
}
