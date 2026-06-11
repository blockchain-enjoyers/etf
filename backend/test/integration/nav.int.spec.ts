import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigModule } from "../../src/config/config.module.js";
import { MarketStatus } from "../../src/domain/market-status.js";
import { OracleSource } from "../../src/domain/oracle.js";
import { BootstrapBasket } from "../../src/nav/basket-source.js";
import { ConfidenceService } from "../../src/nav/confidence.service.js";
import { NavEngineService } from "../../src/nav/nav-engine.service.js";
import { NavRepository } from "../../src/nav/nav.repository.js";
import { PersistenceModule } from "../../src/persistence/persistence.module.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import type { NavReading, SignalRouter } from "../../src/signals/signal-router.js";

const BOOT = "0x0000000000000000000000000000000000000000000000000000000000000001";

function fixedReading(): NavReading {
  return {
    price: 100_000_000_000_000_000_000n,
    confidence: 0n,
    timestamp: 1_750_000_000,
    marketStatus: MarketStatus.Regular,
    source: OracleSource.Chainlink,
    estimated: false,
  };
}

describe("NAV persistence (integration)", () => {
  let prisma: PrismaService;
  let repo: NavRepository;
  let engine: NavEngineService;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PersistenceModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    repo = new NavRepository(prisma);

    const router = { getReading: async () => fixedReading() } as unknown as SignalRouter;
    engine = new NavEngineService(router, new ConfidenceService(200), new BootstrapBasket());

    await prisma.basket.upsert({
      where: { vaultAddress: BOOT },
      update: {},
      create: {
        vaultAddress: BOOT,
        unitSize: "1",
        name: "Bootstrap",
        symbol: "mBOOT",
      },
    });
  });

  afterAll(async () => {
    await prisma.navSnapshot.deleteMany({ where: { vaultAddress: BOOT } });
    await prisma.basket.deleteMany({ where: { vaultAddress: BOOT } });
    await prisma.onApplicationShutdown();
    await moduleRef.close();
  });

  it("computes NAV from signals and persists a NavSnapshot", async () => {
    const result = await engine.computeNav(BOOT);
    const id = await repo.saveSnapshot(BOOT, result);
    expect(id).toBeTruthy();

    const latest = await repo.latest(BOOT);
    expect(latest?.nav.toFixed(0)).toBe("1500000000000000000000");
    expect(latest?.estimated).toBe(false);
    expect(latest?.marketStatus).toBe("Regular");
    expect(latest?.source).toBe("Chainlink");
  });
});
