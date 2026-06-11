import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { PgBoss, type Job, type SendOptions } from "pg-boss";
import { ConfigService } from "../config/config.service.js";
import { PGBOSS_SCHEMA } from "./jobs.constants.js";

/**
 * Owns the pg-boss instance (spec §3 producer role). Starts in OnModuleInit,
 * stops in OnApplicationShutdown (graceful drain). Uses a dedicated schema so its
 * tables never collide with the Prisma-managed `public` schema (spec §6).
 *
 * `notify` issues a Postgres NOTIFY via pg-boss's own connection pool (`getDb().executeSql`);
 * the Stream module LISTENs on the same channel for cross-replica SSE fan-out.
 *
 * NOTE: pg-boss 12.18.2 does not expose a `boss.notify()` method. We issue
 * `SELECT pg_notify($1, $2)` through the boss's internal `IDatabase` adapter
 * (`boss.getDb().executeSql(...)`), which uses the same pooled connection that
 * pg-boss itself manages.
 */
@Injectable()
export class PgBossService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PgBossService.name);
  private boss: PgBoss;

  constructor(private readonly config: ConfigService) {
    this.boss = new PgBoss({
      connectionString: this.config.get("DATABASE_URL"),
      schema: PGBOSS_SCHEMA,
    });
    this.boss.on("error", (err) => this.logger.error("pg-boss error", err as Error));
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    this.logger.log(`pg-boss started (schema=${PGBOSS_SCHEMA})`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true });
    this.logger.log("pg-boss stopped");
  }

  /**
   * Create a named queue (idempotent via upsert-style behavior in pg-boss 12).
   * pg-boss 12 requires a queue to exist before `schedule()` or `work()` is called;
   * call this in onModuleInit before registering workers / schedules.
   */
  async createQueue(name: string): Promise<void> {
    await this.boss.createQueue(name);
  }

  /**
   * Schedule a cron job whose singletonKey guarantees only one instance runs at a
   * time across replicas (producer-singleton, spec §3). Idempotent: pg-boss upserts
   * the schedule by name.
   */
  async scheduleSingleton(name: string, cron: string, data: object = {}): Promise<void> {
    await this.boss.schedule(name, cron, data, { singletonKey: name });
  }

  /** Register a worker handler for a job name. */
  async work(name: string, handler: (jobs: Job[]) => Promise<void>): Promise<void> {
    await this.boss.work(name, handler);
  }

  /**
   * Enqueue a one-off durable job. Public wrapper over the private `boss` instance so callers
   * (e.g. Plan D's keeper producers) can enqueue without reaching the private field. Options
   * carry `singletonKey` (overlap guard), `retryLimit`/`retryBackoff` (durable retries), etc.
   * Returns the job id, or `null` when a `singletonKey` collision means nothing was enqueued.
   */
  async send(name: string, data: object, options: SendOptions = {}): Promise<string | null> {
    return this.boss.send(name, data, options);
  }

  /**
   * Issue a Postgres NOTIFY on the given channel with a JSON-serialised payload.
   *
   * pg-boss 12 does not expose a public `notify(channel, payload)` method.
   * We reach through `boss.getDb()` — the `IDatabase` adapter that pg-boss itself
   * uses internally — and call `executeSql` to run `SELECT pg_notify($1, $2)`.
   * This reuses the boss's existing pool so no extra connection is opened.
   */
  async notify(channel: string, payload: object): Promise<void> {
    await this.boss.getDb().executeSql("SELECT pg_notify($1, $2)", [channel, JSON.stringify(payload)]);
  }
}
