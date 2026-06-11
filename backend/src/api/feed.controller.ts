import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FeedResponse } from "@meridian/sdk";
import { PrismaService } from "../persistence/prisma.service.js";
import { marketStatusToWire } from "../domain/wire.js";

@ApiTags("feed")
@Controller("feed")
export class FeedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: "Latest NAV snapshot per basket (home feed)" })
  async feed(): Promise<FeedResponse> {
    const baskets = await this.prisma.basket.findMany();
    const items = await Promise.all(
      baskets.map(async (b) => {
        const snap = await this.prisma.navSnapshot.findFirst({
          where: { vaultAddress: b.vaultAddress },
          orderBy: { timestamp: "desc" },
        });
        return snap
          ? {
              vaultAddress: b.vaultAddress,
              symbol: b.symbol,
              nav: snap.nav.toFixed(0),
              estimated: snap.estimated,
              marketStatus: marketStatusToWire(snap.marketStatus),
              timestampMs: snap.timestamp.getTime(),
            }
          : null;
      }),
    );
    return { items: items.filter((i): i is NonNullable<typeof i> => i !== null) };
  }
}
