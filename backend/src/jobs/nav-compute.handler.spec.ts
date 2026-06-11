import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavEngineService } from "../nav/nav-engine.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { NAV_UPDATE_CHANNEL } from "./jobs.constants.js";
import { NavComputeHandler } from "./nav-compute.handler.js";
import { PgBossService } from "./pg-boss.service.js";

describe("NavComputeHandler", () => {
  let handler: NavComputeHandler;
  const navResult = {
    nav: 123_000_000_000_000_000_000n,
    confidenceLower: 120_000_000_000_000_000_000n,
    confidenceUpper: 126_000_000_000_000_000_000n,
    marketStatus: "Closed" as const,
    source: "LastClose" as const,
    estimated: true,
    timestamp: 1_717_000_000,
  };
  const computeNav = vi.fn(async () => navResult);
  const created = { id: "snap-1" };
  const create = vi.fn(async () => created);
  const notify = vi.fn(async () => {});

  beforeEach(async () => {
    computeNav.mockClear();
    create.mockClear();
    notify.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        NavComputeHandler,
        { provide: NavEngineService, useValue: { computeNav } },
        { provide: PrismaService, useValue: { navSnapshot: { create } } },
        { provide: PgBossService, useValue: { notify } },
      ],
    }).compile();
    handler = moduleRef.get(NavComputeHandler);
  });

  it("computes, persists a NavSnapshot with 18-dec decimals + estimated flag, then NOTIFYs", async () => {
    await handler.run("0xbasket");
    expect(computeNav).toHaveBeenCalledWith("0xbasket");
    const calls = create.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const data = firstCall![0].data;
    expect(data.vaultAddress).toBe("0xbasket");
    expect(data.nav).toBe("123000000000000000000");
    expect(data.estimated).toBe(true); // IRON RULE carried through
    expect(data.marketStatus).toBe("Closed");
    expect(data.source).toBe("LastClose");
    expect(notify).toHaveBeenCalledWith(NAV_UPDATE_CHANNEL, {
      vaultAddress: "0xbasket",
      navSnapshotId: "snap-1",
    });
  });
});
