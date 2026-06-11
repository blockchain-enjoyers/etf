import { Injectable } from "@nestjs/common";
import { erc20Abi } from "viem";
import { BasketVaultReader } from "../../contracts/basket-vault.reader.js";
import { ChainService } from "../../chain/chain.service.js";
import { PrismaService } from "../../persistence/prisma.service.js";
import { type QuoteAsset, RedeemQuotePort } from "./redeem-quote.port.js";

@Injectable()
export class LiveRedeemQuoteAdapter extends RedeemQuotePort {
  constructor(
    private readonly vault: BasketVaultReader,
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {
    super();
  }

  async quote(vault: `0x${string}`, amount: bigint): Promise<QuoteAsset[]> {
    const basket = await this.prisma.basket.findUnique({
      where: { vaultAddress: vault },
      include: { constituents: true },
    });
    // Basket + Managed expose previewRedeem (Managed includes fee dilution on-chain).
    if (!basket || basket.vaultType !== "Committed") {
      return this.vault.previewRedeem(vault, amount);
    }
    // Committed has no previewRedeem: compute pro-rata from live balances.
    const supply = await this.chain.publicClient.readContract({
      address: vault,
      abi: erc20Abi,
      functionName: "totalSupply",
    });
    if (supply === 0n) return [];
    const out: QuoteAsset[] = [];
    for (const c of basket.constituents) {
      const token = c.token as `0x${string}`;
      const bal = await this.chain.publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vault],
      });
      out.push({ token, amount: (bal * amount) / supply });
    }
    return out;
  }
}
