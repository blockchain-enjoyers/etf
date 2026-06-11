import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { firstValueFrom } from "rxjs";
import { take } from "rxjs/operators";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { ConfigModule } from "../../src/config/config.module.js";
import { PersistenceModule } from "../../src/persistence/persistence.module.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { NAV_UPDATE_CHANNEL } from "../../src/jobs/jobs.constants.js";
import { NavStreamService } from "../../src/stream/nav-stream.service.js";

const VAULT = "0x000000000000000000000000000000000000ns01";

describe("NavStreamService (integration)", () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;
  let prisma: PrismaService;
  let stream: NavStreamService;
  let notifier: Client;
  const url = inject("databaseUrl");

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PersistenceModule],
      providers: [NavStreamService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    stream = moduleRef.get(NavStreamService);
    await prisma.onModuleInit();
    await stream.onModuleInit();
    notifier = new Client({ connectionString: url });
    await notifier.connect();

    await prisma.basket.create({
      data: {
        vaultAddress: VAULT,
        unitSize: "1",
        name: "Stream Basket",
        symbol: "mSTRM",
      },
    });
  });

  afterAll(async () => {
    await stream.onApplicationShutdown();
    await prisma.onApplicationShutdown();
    await notifier.end();
    await moduleRef.close();
  });

  it("emits a NavResponse when a nav_update NOTIFY references a persisted snapshot", async () => {
    const snap = await prisma.navSnapshot.create({
      data: {
        vaultAddress: VAULT,
        nav: "100.5",
        confidenceLower: "99.0",
        confidenceUpper: "102.0",
        marketStatus: "Regular",
        source: "Chainlink",
        estimated: false,
        timestamp: new Date(1_717_000_000_000),
      },
    });

    const emitted = firstValueFrom(stream.observe(VAULT).pipe(take(1)));
    await notifier.query(`SELECT pg_notify($1, $2)`, [
      NAV_UPDATE_CHANNEL,
      JSON.stringify({ vaultAddress: VAULT, navSnapshotId: snap.id }),
    ]);

    const r = await emitted;
    expect(r.nav).toBe("100.5");
    expect(r.marketStatus).toBe("regular");
    expect(r.estimated).toBe(false);
  });
});
