import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ThrottlerModule, seconds } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Controller, Get, Module } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

@Controller("ping")
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: seconds(60), limit: 2 }] })],
  controllers: [PingController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class ThrottleTestModule {}

describe("Throttler (e2e)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ThrottleTestModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ trustProxy: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 429 after exceeding the limit", async () => {
    await app.inject({ method: "GET", url: "/ping" });
    await app.inject({ method: "GET", url: "/ping" });
    const third = await app.inject({ method: "GET", url: "/ping" });
    expect(third.statusCode).toBe(429);
  });
});
