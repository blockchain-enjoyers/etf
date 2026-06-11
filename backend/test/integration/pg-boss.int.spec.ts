import { Client } from "pg";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { NAV_UPDATE_CHANNEL, PGBOSS_SCHEMA } from "../../src/jobs/jobs.constants.js";

describe("pg-boss (integration)", () => {
  let boss: PgBoss;
  let listener: Client;
  const connectionString = inject("databaseUrl");

  beforeAll(async () => {
    // Use a short polling interval so the worker drains quickly in the test.
    boss = new PgBoss({ connectionString, schema: PGBOSS_SCHEMA, pollingIntervalSeconds: 0.5 });
    await boss.start();
    listener = new Client({ connectionString });
    await listener.connect();
    await listener.query(`LISTEN ${NAV_UPDATE_CHANNEL}`);
  });

  afterAll(async () => {
    await boss.stop({ graceful: true });
    await listener.end();
  });

  it("runs a worker for an enqueued job and delivers a NOTIFY payload", async () => {
    // pg-boss 12 requires the queue to exist before sending (createQueue is idempotent).
    await boss.createQueue("test-job");

    const ran: string[] = [];
    // work() returns a workerId which can be used with notifyWorker() to wake the worker immediately.
    const workerId = await boss.work("test-job", async (jobs) => {
      for (const j of jobs) ran.push((j.data as { tag: string }).tag);
    });

    const received = new Promise<string>((resolve) => {
      listener.on("notification", (msg) => resolve(msg.payload ?? ""));
    });

    await boss.send("test-job", { tag: "hello" });
    // pg-boss 12.18.2 does not expose a public notify(); use getDb().executeSql() to issue pg_notify.
    await boss.getDb().executeSql("SELECT pg_notify($1, $2)", [
      NAV_UPDATE_CHANNEL,
      JSON.stringify({ vaultAddress: "0x1", navSnapshotId: "snap1" }),
    ]);

    const payload = await received;
    expect(JSON.parse(payload)).toEqual({ vaultAddress: "0x1", navSnapshotId: "snap1" });

    // Wake the worker immediately rather than waiting for the next polling cycle.
    boss.notifyWorker(workerId);
    await new Promise((r) => setTimeout(r, 2000));
    expect(ran).toContain("hello");
  });
});
