import { Module } from "@nestjs/common";
import { NavStreamService } from "./nav-stream.service.js";
import { StreamController } from "./stream.controller.js";

/** API role: per-replica LISTEN nav_update fan-out + the SSE endpoint (spec §3, §7). */
@Module({
  providers: [NavStreamService],
  controllers: [StreamController],
  exports: [NavStreamService],
})
export class StreamModule {}
