import { Test } from "@nestjs/testing";
import { firstValueFrom } from "rxjs";
import { filter, take } from "rxjs/operators";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../config/config.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { NavStreamService } from "./nav-stream.service.js";

describe("NavStreamService", () => {
  let service: NavStreamService;
  const findUnique = vi.fn(async () => ({
    id: "snap-1",
    vaultAddress: "0xvault",
    nav: { toFixed: () => "123.0", toString: () => "123.0" },
    confidenceLower: { toFixed: () => "120.0", toString: () => "120.0" },
    confidenceUpper: { toFixed: () => "126.0", toString: () => "126.0" },
    marketStatus: "Closed",
    source: "LastClose",
    estimated: true,
    timestamp: new Date(1_717_000_000_000),
  }));

  beforeEach(async () => {
    findUnique.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        NavStreamService,
        { provide: ConfigService, useValue: { get: () => "postgresql://u:p@localhost/db" } },
        { provide: PrismaService, useValue: { navSnapshot: { findUnique } } },
      ],
    }).compile();
    service = moduleRef.get(NavStreamService);
  });

  it("loads the snapshot named in the payload and emits a lowercased NavResponse", async () => {
    const emitted = firstValueFrom(
      service.observe("0xvault").pipe(filter((r) => r.vaultAddress === "0xvault"), take(1)),
    );
    await service.handleNotification(JSON.stringify({ vaultAddress: "0xvault", navSnapshotId: "snap-1" }));
    const r = await emitted;
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "snap-1" } });
    expect(r.nav).toBe("123.0");
    expect(r.estimated).toBe(true);
    expect(r.marketStatus).toBe("closed");
    expect(r.source).toBe("lastClose");
  });

  it("ignores updates for a different basket", async () => {
    const received: string[] = [];
    const sub = service.observe("0xother").subscribe((r) => received.push(r.vaultAddress));
    await service.handleNotification(JSON.stringify({ vaultAddress: "0xvault", navSnapshotId: "snap-1" }));
    sub.unsubscribe();
    expect(received).toHaveLength(0);
  });
});
