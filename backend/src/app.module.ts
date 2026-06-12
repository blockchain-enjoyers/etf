import { Module } from "@nestjs/common";
import { APP_GUARD, APP_PIPE } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule, seconds } from "@nestjs/throttler";
import { ZodValidationPipe } from "nestjs-zod";
import { OpenTelemetryModule } from "nestjs-otel";
import { ApiModule } from "./api/api.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { ConfigModule } from "./config/config.module.js";
import { DemoModule } from "./demo/demo.module.js";
import { HealthModule } from "./health/health.module.js";
import { IndexerModule } from "./indexer/indexer.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { AppLoggerModule } from "./observability/logger.module.js";
import { PersistenceModule } from "./persistence/persistence.module.js";
import { StreamModule } from "./stream/stream.module.js";
import { KeeperModule } from "./keeper/keeper.module.js";
import { TxModule } from "./tx/tx.module.js";

@Module({
  imports: [
    AppLoggerModule,
    // nestjs-otel 8.0.3 OpenTelemetryMetrics only supports hostMetrics (no apiMetrics option).
    OpenTelemetryModule.forRoot({ metrics: { hostMetrics: true } }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: seconds(60), limit: 120 }] }),
    ConfigModule,
    PersistenceModule,
    HealthModule,
    IndexerModule,
    JobsModule,
    StreamModule,
    ApiModule,
    TxModule,
    DemoModule,
    CatalogModule,
    // v2
    KeeperModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe }, // validates createZodDto bodies/queries
  ],
})
export class AppModule {}
