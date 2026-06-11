import { Module } from "@nestjs/common";
import { FairValueService } from "./fair-value.service.js";

@Module({
  providers: [FairValueService],
  exports: [FairValueService],
})
export class FairValueModule {}
