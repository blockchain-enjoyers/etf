import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiModule } from "../../src/api/api.module.js";
import { ChainModule } from "../../src/chain/chain.module.js";
import { ConfigModule } from "../../src/config/config.module.js";
import { ContractsModule } from "../../src/contracts/contracts.module.js";
import { DemoModule } from "../../src/demo/demo.module.js";
import { RedeemQuotePort } from "../../src/capabilities/redeem-quote/redeem-quote.port.js";
import { PersistenceModule } from "../../src/persistence/persistence.module.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";

const VAULT = "0x000000000000000000000000000000000000aaa1";

describe("API (e2e)", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, ChainModule, ContractsModule, PersistenceModule, ApiModule, DemoModule],
      providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
    })
      .overrideProvider(RedeemQuotePort)
      .useValue({ quote: async () => [{ token: "0xA" as const, amount: 5n }] })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);

    await prisma.basket.create({
      data: {
        vaultAddress: VAULT,
        unitSize: "1000",
        name: "API Basket",
        symbol: "mAPI",
        constituents: {
          create: [{ token: "0xA", unitQty: "10" }],
        },
      },
    });
    await prisma.navSnapshot.create({
      data: {
        vaultAddress: VAULT,
        nav: "123.45",
        confidenceLower: "120.0",
        confidenceUpper: "126.0",
        marketStatus: "Closed",
        source: "LastClose",
        estimated: true,
        timestamp: new Date(1_717_000_000_000),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /baskets lists the seeded basket", async () => {
    const res = await app.inject({ method: "GET", url: "/baskets" });
    expect(res.statusCode).toBe(200);
    const baskets = res.json() as { symbol: string }[];
    expect(baskets.some((b) => b.symbol === "mAPI")).toBe(true);
  });

  it("GET /baskets/:id/nav returns a lowercased NavResponse with estimated=true", async () => {
    const res = await app.inject({ method: "GET", url: `/baskets/${VAULT}/nav` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nav).toBe("123.45");
    expect(body.marketStatus).toBe("closed");
    expect(body.source).toBe("lastClose");
    expect(body.estimated).toBe(true);
  });

  it("POST /baskets/:id/redeem-quote gates value-settle when NAV is estimated (IRON RULE)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/baskets/${VAULT}/redeem-quote`,
      payload: { basketTokenAmount: "1000" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { gateState: { gated: boolean; reason: string }; assets: unknown[] };
    expect(body.gateState.gated).toBe(true);
    expect(body.gateState.reason).toBe("estimated");
    expect(body.assets.length).toBeGreaterThan(0);
  });

  it("POST /baskets/:id/redeem-quote 400s on an invalid (non-decimal) amount", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/baskets/${VAULT}/redeem-quote`,
      payload: { basketTokenAmount: "abc" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /feed returns the latest snapshot per basket", async () => {
    const res = await app.inject({ method: "GET", url: "/feed" });
    expect(res.statusCode).toBe(200);
    const { items } = res.json() as { items: { symbol: string }[] };
    expect(items.some((i) => i.symbol === "mAPI")).toBe(true);
  });

  it("GET /demo/:id returns a static series", async () => {
    const res = await app.inject({ method: "GET", url: "/demo/weekend-gap" });
    expect(res.statusCode).toBe(200);
    expect(res.json().frames.length).toBeGreaterThan(0);
  });
});
