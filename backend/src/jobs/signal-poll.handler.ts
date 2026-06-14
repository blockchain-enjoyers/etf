import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../persistence/prisma.service.js";
import { SignalRouter } from "../signals/signal-router.js";
import { catalogPrice18 } from "../contracts/catalog-price.js";
import { MarketStatus } from "../domain/market-status.js";
import { OracleSource } from "../domain/oracle.js";

/**
 * Producer step (spec §5.1): pull fresh oracle readings for every distinct constituent
 * token and persist a PriceSnapshot row (18-dec). Non-reverting by construction — the
 * SignalRouter (Plan B, cockatiel retry+breaker) returns a degraded reading rather than
 * throwing, so a stale/halted source widens the band downstream instead of crashing.
 */
@Injectable()
export class SignalPollHandler {
  private readonly logger = new Logger(SignalPollHandler.name);

  constructor(
    private readonly signals: SignalRouter,
    private readonly prisma: PrismaService,
  ) {}

  async run(): Promise<void> {
    const tokens = await this.prisma.constituent.findMany({
      distinct: ["token"],
      select: { token: true },
    });
    for (const { token } of tokens) {
      const reading = await this.signals.getReading(token);
      if (reading.price !== 0n) {
        await this.prisma.priceSnapshot.create({
          data: {
            token,
            price: reading.price.toString(),
            confidence: reading.confidence.toString(),
            marketStatus: reading.marketStatus,
            source: reading.source,
            timestamp: new Date(reading.timestamp * 1000),
          },
        });
        continue;
      }
      // No live source and no last-close anchor yet. For a demo-catalog stock, seed a Regular anchor
      // from the catalog baseline — the next poll's LastClose adapter walks it into a living 24/7 price.
      const baseline = catalogPrice18(token);
      if (baseline === undefined) {
        this.logger.warn(`signal-poll: no usable price for ${token}; skipping snapshot`);
        continue;
      }
      await this.prisma.priceSnapshot.create({
        data: {
          token,
          price: baseline.toString(),
          confidence: "0",
          marketStatus: MarketStatus.Regular,
          source: OracleSource.LastClose,
          timestamp: new Date(),
        },
      });
    }
    this.logger.debug(`signal-poll wrote ${tokens.length} price snapshots`);
  }
}
