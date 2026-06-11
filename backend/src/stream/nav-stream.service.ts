import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { Client, type Notification } from "pg";
import { Observable, Subject } from "rxjs";
import { filter } from "rxjs/operators";
import type { NavResponse } from "@meridian/sdk";
import { ConfigService } from "../config/config.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { marketStatusToWire, oracleSourceToWire } from "../domain/wire.js";
import { NAV_UPDATE_CHANNEL, type NavUpdatePayload } from "../jobs/jobs.constants.js";

/**
 * API role (spec §3): each replica runs its own dedicated pg Client doing
 * LISTEN nav_update and fans the payload out to its local SSE subscribers via an
 * RxJS Subject. On a notification it loads the referenced NavSnapshot and emits a
 * fully-formed NavResponse (lowercased enums, string decimals). Reconnects on error.
 */
@Injectable()
export class NavStreamService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NavStreamService.name);
  private client?: Client;
  private readonly subject = new Subject<NavResponse>();
  private closed = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.closed = true;
    this.subject.complete();
    await this.client?.end().catch(() => undefined);
    this.logger.log("nav_update LISTEN client closed");
  }

  /** Per-basket SSE feed. */
  observe(vaultAddress: string): Observable<NavResponse> {
    return this.subject.asObservable().pipe(filter((r) => r.vaultAddress === vaultAddress));
  }

  /** Exposed for tests + reuse by the LISTEN callback. */
  async handleNotification(rawPayload: string | undefined): Promise<void> {
    if (!rawPayload) return;
    let payload: NavUpdatePayload;
    try {
      payload = JSON.parse(rawPayload) as NavUpdatePayload;
    } catch {
      this.logger.warn(`unparseable nav_update payload: ${rawPayload}`);
      return;
    }
    const snap = await this.prisma.navSnapshot.findUnique({ where: { id: payload.navSnapshotId } });
    if (!snap) return;
    this.subject.next({
      vaultAddress: snap.vaultAddress,
      nav: snap.nav.toFixed(0),
      confidenceLower: snap.confidenceLower.toFixed(0),
      confidenceUpper: snap.confidenceUpper.toFixed(0),
      marketStatus: marketStatusToWire(snap.marketStatus),
      estimated: snap.estimated,
      source: oracleSourceToWire(snap.source),
      timestampMs: snap.timestamp.getTime(),
    });
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    this.client = new Client({ connectionString: this.config.get("DATABASE_URL") });
    this.client.on("error", (err) => {
      this.logger.error("LISTEN client error; reconnecting", err);
      void this.reconnect();
    });
    this.client.on("notification", (msg: Notification) => {
      void this.handleNotification(msg.payload);
    });
    await this.client.connect();
    await this.client.query(`LISTEN ${NAV_UPDATE_CHANNEL}`);
    this.logger.log(`LISTEN ${NAV_UPDATE_CHANNEL} active`);
  }

  private async reconnect(): Promise<void> {
    if (this.closed) return;
    await this.client?.end().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1000));
    await this.connect().catch((err) => this.logger.error("reconnect failed", err as Error));
  }
}
