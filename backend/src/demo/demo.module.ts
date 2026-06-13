import { Module } from "@nestjs/common";
import { DemoController } from "../api/demo.controller.js";
import { DemoService } from "./demo.service.js";
import { SceneOracleConfig } from "./scene-oracle.config.js";
import { SceneOracleService } from "./scene-oracle.service.js";
import { SceneOracleController } from "./scene-oracle.controller.js";

/** Static V0 demo artifacts (spec §7). Offline — no chain, no wallet, no DB. */
@Module({
  providers: [DemoService, SceneOracleConfig, SceneOracleService],
  controllers: [DemoController, SceneOracleController],
  exports: [DemoService],
})
export class DemoModule {}
