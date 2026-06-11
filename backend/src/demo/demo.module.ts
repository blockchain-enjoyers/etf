import { Module } from "@nestjs/common";
import { DemoController } from "../api/demo.controller.js";
import { DemoService } from "./demo.service.js";

/** Static V0 demo artifacts (spec §7). Offline — no chain, no wallet, no DB. */
@Module({
  providers: [DemoService],
  controllers: [DemoController],
  exports: [DemoService],
})
export class DemoModule {}
