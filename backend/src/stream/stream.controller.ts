import { Controller, Param, Sse } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import type { MessageEvent } from "@nestjs/common";
import { map, type Observable } from "rxjs";
import type { NavResponse } from "@meridian/sdk";
import { NavStreamService } from "./nav-stream.service.js";

@ApiTags("baskets")
@Controller("baskets")
export class StreamController {
  constructor(private readonly stream: NavStreamService) {}

  @Sse(":id/nav/stream")
  @ApiOperation({ summary: "Live NAV updates (SSE), fed by Postgres LISTEN nav_update" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  navStream(@Param("id") id: string): Observable<MessageEvent> {
    return this.stream.observe(id).pipe(
      map((nav: NavResponse): MessageEvent => ({ data: nav, type: "nav" })),
    );
  }
}
