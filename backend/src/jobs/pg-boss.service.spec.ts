import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../config/config.service.js";
import { JOB_NAV_COMPUTE, NAV_UPDATE_CHANNEL } from "./jobs.constants.js";
import { PgBossService } from "./pg-boss.service.js";

/**
 * FakeBoss doubles the pg-boss 12 public surface used by PgBossService.
 *
 * pg-boss 12.18.2 has no `boss.notify(channel, payload)` method.
 * PgBossService.notify() calls `this.boss.getDb().executeSql(...)` to issue
 * SELECT pg_notify($1, $2). The fake mirrors this with a `getDb()` that
 * returns a trackable `executeSql` spy.
 */
class FakeBoss {
  started = false;
  stopped = false;
  scheduled: { name: string; cron: string; opts: unknown }[] = [];
  sent: { name: string; data: unknown; opts: unknown }[] = [];
  workers: Record<string, (jobs: unknown[]) => Promise<void>> = {};
  sqlCalls: { text: string; values: unknown[] }[] = [];

  start = vi.fn(async () => {
    this.started = true;
  });
  stop = vi.fn(async () => {
    this.stopped = true;
  });
  schedule = vi.fn(async (name: string, cron: string, _data: unknown, opts: unknown) => {
    this.scheduled.push({ name, cron, opts });
  });
  send = vi.fn(async (name: string, data: unknown, opts: unknown) => {
    this.sent.push({ name, data, opts });
    return `${name}-job-id`;
  });
  work = vi.fn(async (name: string, handler: (jobs: unknown[]) => Promise<void>) => {
    this.workers[name] = handler;
    return name;
  });
  // pg-boss 12 exposes getDb(): IDatabase where IDatabase has executeSql().
  getDb = vi.fn(() => ({
    executeSql: vi.fn(async (text: string, values: unknown[]) => {
      this.sqlCalls.push({ text, values });
      return { rows: [] };
    }),
  }));
  // The error event listener is registered in the constructor — provide a no-op `on`.
  on = vi.fn();
}

describe("PgBossService", () => {
  let service: PgBossService;
  let fake: FakeBoss;

  beforeEach(async () => {
    fake = new FakeBoss();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PgBossService,
        { provide: ConfigService, useValue: { get: () => "postgresql://u:p@localhost:5432/db" } },
      ],
    }).compile();
    service = moduleRef.get(PgBossService);
    // Inject the fake boss in place of a real connection.
    (service as unknown as { boss: FakeBoss }).boss = fake;
  });

  it("registers a scheduled producer job with a singletonKey", async () => {
    await service.scheduleSingleton(JOB_NAV_COMPUTE, "*/30 * * * * *");
    expect(fake.schedule).toHaveBeenCalledOnce();
    const call = fake.scheduled[0]!;
    expect(call.name).toBe(JOB_NAV_COMPUTE);
    expect(call.opts).toMatchObject({ singletonKey: JOB_NAV_COMPUTE });
  });

  it("registers a worker handler under the job name", async () => {
    const handler = vi.fn(async () => {});
    await service.work(JOB_NAV_COMPUTE, handler);
    expect(fake.workers[JOB_NAV_COMPUTE]).toBeDefined();
  });

  it("enqueues a one-off job via the public send wrapper (with singletonKey)", async () => {
    const id = await service.send(JOB_NAV_COMPUTE, { basketId: "0x1" }, { singletonKey: "k1" });
    expect(fake.send).toHaveBeenCalledOnce();
    expect(fake.sent[0]).toMatchObject({
      name: JOB_NAV_COMPUTE,
      data: { basketId: "0x1" },
      opts: { singletonKey: "k1" },
    });
    expect(id).toBe(`${JOB_NAV_COMPUTE}-job-id`);
  });

  it("emits a NOTIFY on the nav_update channel with the payload via getDb().executeSql", async () => {
    await service.notify(NAV_UPDATE_CHANNEL, { vaultAddress: "0x1", navSnapshotId: "snap1" });
    expect(fake.getDb).toHaveBeenCalledOnce();
    const sql = fake.sqlCalls[0]!;
    expect(sql.text).toContain("pg_notify");
    expect(sql.values[0]).toBe(NAV_UPDATE_CHANNEL);
    expect(JSON.parse(sql.values[1] as string)).toEqual({ vaultAddress: "0x1", navSnapshotId: "snap1" });
  });

  it("stops the boss on application shutdown", async () => {
    await service.onApplicationShutdown();
    expect(fake.stop).toHaveBeenCalledOnce();
  });
});
