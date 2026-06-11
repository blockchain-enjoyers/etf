import { Injectable, Logger } from "@nestjs/common";
import { navResultToSnapshotInput } from "../domain/oracle.js";
import { NavEngineService } from "../nav/nav-engine.service.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { NAV_UPDATE_CHANNEL, type NavUpdatePayload } from "./jobs.constants.js";
import { PgBossService } from "./pg-boss.service.js";

/**
 * Producer step (spec §5.1): compute NAV off-chain (Plan B NavEngineService),
 * persist a NavSnapshot (18-dec USD as Decimal strings — never float), then issue
 * NOTIFY nav_update so every API replica's LISTEN can push the new snapshot over SSE.
 * The IRON RULE flag (estimated) is carried verbatim from NavResult into the row and
 * out to the stream — a closed-market estimate is NEVER a settlement price.
 */
@Injectable()
export class NavComputeHandler {
  private readonly logger = new Logger(NavComputeHandler.name);

  constructor(
    private readonly nav: NavEngineService,
    private readonly prisma: PrismaService,
    private readonly boss: PgBossService,
  ) {}

  async run(vaultAddress: string): Promise<void> {
    const result = await this.nav.computeNav(vaultAddress);
    const snapshot = await this.prisma.navSnapshot.create({
      data: navResultToSnapshotInput(vaultAddress, result),
    });
    const payload: NavUpdatePayload = { vaultAddress, navSnapshotId: snapshot.id };
    await this.boss.notify(NAV_UPDATE_CHANNEL, payload);
    this.logger.debug(`nav-compute ${vaultAddress} -> ${snapshot.id} (estimated=${result.estimated})`);
  }

  /** Fan out NAV computation over every indexed (non-frozen) basket; per-vault errors are isolated
   *  so one un-priceable vault never blocks the rest. */
  async runAll(): Promise<void> {
    const baskets = await this.prisma.basket.findMany({ select: { vaultAddress: true, frozen: true } });
    for (const b of baskets) {
      if (b.frozen) continue;
      try {
        await this.run(b.vaultAddress);
      } catch (e) {
        this.logger.warn(`nav-compute ${b.vaultAddress} failed: ${(e as Error).message}`);
      }
    }
  }
}
