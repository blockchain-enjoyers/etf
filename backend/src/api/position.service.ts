import { Injectable } from "@nestjs/common";
import { erc20Abi } from "viem";
import type { AccountHoldingsResponse } from "@meridian/sdk";
import { PrismaService } from "../persistence/prisma.service.js";
import { ChainService } from "../chain/chain.service.js";

@Injectable()
export class PositionService {
  constructor(private readonly prisma: PrismaService, private readonly chain: ChainService) {}

  async accountHoldings(account: string): Promise<AccountHoldingsResponse> {
    const baskets = await this.prisma.basket.findMany();
    if (baskets.length === 0) return { account, holdings: [] };
    const balances = await this.chain.publicClient.multicall({
      allowFailure: true,
      contracts: baskets.map((b) => ({
        address: b.vaultAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account as `0x${string}`],
      })),
    });
    const holdings: AccountHoldingsResponse["holdings"] = [];
    for (let i = 0; i < baskets.length; i++) {
      const res = balances[i];
      const balance = res?.status === "success" ? (res.result as bigint) : 0n;
      if (balance === 0n) continue;
      const b = baskets[i]!;
      const snap = await this.prisma.navSnapshot.findFirst({
        where: { vaultAddress: b.vaultAddress },
        orderBy: { timestamp: "desc" },
      });
      const nav = snap ? BigInt(snap.nav.toFixed(0)) : 0n;
      const valueUsd = (balance * nav) / 10n ** 18n;
      holdings.push({
        vaultAddress: b.vaultAddress,
        symbol: b.symbol,
        balance: balance.toString(),
        valueUsd: valueUsd.toString(),
        estimated: snap ? snap.estimated : true,
      });
    }
    return { account, holdings };
  }
}
