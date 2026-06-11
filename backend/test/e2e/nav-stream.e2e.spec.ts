/**
 * NAV SSE stream e2e test.
 *
 * The Fastify inject path is unusable for SSE because NestJS's SseStream calls
 * `req.socket.setKeepAlive()`, which does not exist on light-my-request's fake
 * socket, causing an unrecoverable 500 before any SSE frames are written.
 *
 * Deterministic alternative (per plan note): spin up the full NestJS + StreamModule
 * with a real Postgres testcontainer, insert a NavSnapshot, issue pg_notify, then
 * subscribe directly to StreamController.navStream(vaultAddress) and assert it emits
 * a MessageEvent carrying the expected nav value.
 *
 * This is a faithful end-to-end exercise of the complete pipe:
 *   pg_notify → NavStreamService LISTEN callback → handleNotification → Prisma load
 *   → Subject.next → StreamController.navStream() Observable → MessageEvent({ data })
 */
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { firstValueFrom } from "rxjs";
import { take } from "rxjs/operators";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { ConfigModule } from "../../src/config/config.module.js";
import { PersistenceModule } from "../../src/persistence/persistence.module.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { NAV_UPDATE_CHANNEL } from "../../src/jobs/jobs.constants.js";
import { StreamModule } from "../../src/stream/stream.module.js";
import { StreamController } from "../../src/stream/stream.controller.js";
import type { NavResponse } from "@meridian/sdk";
import type { MessageEvent } from "@nestjs/common";

const VAULT = "0x000000000000000000000000000000000000bbe1";

describe("NAV SSE stream (e2e)", () => {
  let prisma: PrismaService;
  let controller: StreamController;
  let notifier: Client;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;
  const url = inject("databaseUrl");

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PersistenceModule, StreamModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    controller = moduleRef.get(StreamController);

    await moduleRef.init();

    notifier = new Client({ connectionString: url });
    await notifier.connect();

    await prisma.basket.create({
      data: {
        vaultAddress: VAULT,
        unitSize: "1",
        name: "SSE Basket",
        symbol: "mSSE",
      },
    });
  });

  afterAll(async () => {
    await notifier.end();
    await moduleRef.close();
  });

  it("streams a nav event for the basket after a NOTIFY", async () => {
    const snap = await prisma.navSnapshot.create({
      data: {
        vaultAddress: VAULT,
        nav: "77.7",
        confidenceLower: "77.0",
        confidenceUpper: "78.0",
        marketStatus: "Regular",
        source: "Chainlink",
        estimated: false,
        timestamp: new Date(1_717_000_000_000),
      },
    });

    const eventPromise = firstValueFrom(
      controller.navStream(VAULT).pipe(take(1)),
    );

    await new Promise((r) => setTimeout(r, 300));
    await notifier.query(`SELECT pg_notify($1, $2)`, [
      NAV_UPDATE_CHANNEL,
      JSON.stringify({ vaultAddress: VAULT, navSnapshotId: snap.id }),
    ]);

    const event: MessageEvent = await eventPromise;

    expect(event.type).toBe("nav");
    const nav = event.data as NavResponse;
    expect(nav.nav).toBe("77.7");
    expect(nav.vaultAddress).toBe(VAULT);
    expect(nav.marketStatus).toBe("regular");
    expect(nav.estimated).toBe(false);
  });
});
