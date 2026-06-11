import { Injectable } from "@nestjs/common";
import { BasketVaultReader } from "../../contracts/basket-vault.reader.js";
import { PrismaService } from "../../persistence/prisma.service.js";
import type { QuoteAsset } from "../redeem-quote/redeem-quote.port.js";
import { CreateQuotePort } from "./create-quote.port.js";

@Injectable()
export class LiveCreateQuoteAdapter extends CreateQuotePort {
  constructor(
    private readonly vault: BasketVaultReader,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async quote(vault: `0x${string}`, nUnits: bigint): Promise<QuoteAsset[]> {
    const basket = await this.prisma.basket.findUnique({
      where: { vaultAddress: vault },
      include: { constituents: true },
    });
    // Basket + Managed expose previewCreate; Committed has none (recipe is in calldata).
    if (!basket || basket.vaultType !== "Committed") {
      return this.vault.previewCreate(vault, nUnits);
    }
    return basket.constituents.map((c) => ({
      token: c.token as `0x${string}`,
      amount: BigInt(c.unitQty.toString()) * nUnits,
    }));
  }
}
