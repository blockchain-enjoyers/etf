import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigModule } from "../../src/config/config.module.js";
import { PersistenceModule } from "../../src/persistence/persistence.module.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";

describe("PrismaService (integration)", () => {
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PersistenceModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onApplicationShutdown();
    await moduleRef.close();
  });

  it("connects and round-trips a Basket row", async () => {
    const created = await prisma.basket.create({
      data: {
        vaultAddress: "0xvault_prisma_int",
        unitSize: "100",
        name: "Test Basket",
        symbol: "mTEST",
      },
    });
    expect(created.vaultAddress).toBe("0xvault_prisma_int");

    const found = await prisma.basket.findUnique({ where: { vaultAddress: "0xvault_prisma_int" } });
    expect(found?.name).toBe("Test Basket");
  });
});
