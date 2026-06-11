import { Controller, Get } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from "@nestjs/terminus";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../persistence/prisma.service.js";

@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly db: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get("live")
  @HealthCheck()
  live() {
    return this.health.check([() => this.memory.checkHeap("memory_heap", 512 * 1024 * 1024)]);
  }

  @Get("ready")
  @HealthCheck()
  ready() {
    return this.health.check([() => this.db.pingCheck("database", this.prisma)]);
  }
}
