import { Injectable } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

/** `findReference` returns the vault address + its first constituent (reference token). */
@Injectable()
export class BasketRepository {
  async findReference(
    vaultAddress: string,
  ): Promise<{ vaultAddress: string; referenceToken: string } | null> {
    const basket = await this.prisma.basket.findUnique({
      where: { vaultAddress },
      select: {
        vaultAddress: true,
        constituents: { take: 1, select: { token: true } },
      },
    });
    if (!basket) return null;
    const top = basket.constituents[0];
    if (!top) return null;
    return { vaultAddress: basket.vaultAddress, referenceToken: top.token };
  }

  constructor(private readonly prisma: PrismaService) {}
}
