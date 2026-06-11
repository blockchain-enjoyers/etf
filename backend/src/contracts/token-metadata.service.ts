import { Injectable } from "@nestjs/common";
import { erc20Abi } from "viem";
import { PrismaService } from "../persistence/prisma.service.js";
import { ChainService } from "../chain/chain.service.js";

export interface TokenMeta {
  token: string;
  symbol: string;
  name: string | null;
  decimals: number;
}

@Injectable()
export class TokenMetadataService {
  constructor(private readonly prisma: PrismaService, private readonly chain: ChainService) {}

  async getMany(tokens: string[]): Promise<Record<string, TokenMeta>> {
    const keys = [...new Set(tokens.map((t) => t.toLowerCase()))];
    const out: Record<string, TokenMeta> = {};
    if (keys.length === 0) return out;

    const cached = await this.prisma.tokenMetadata.findMany({ where: { token: { in: keys } } });
    for (const c of cached) out[c.token] = { token: c.token, symbol: c.symbol, name: c.name, decimals: c.decimals };

    const missing = keys.filter((k) => !out[k]);
    for (const token of missing) {
      try {
        const [sym, nm, dec] = await this.chain.publicClient.multicall({
          allowFailure: true,
          contracts: [
            { address: token as `0x${string}`, abi: erc20Abi, functionName: "symbol" },
            { address: token as `0x${string}`, abi: erc20Abi, functionName: "name" },
            { address: token as `0x${string}`, abi: erc20Abi, functionName: "decimals" },
          ],
        });
        const meta: TokenMeta = {
          token,
          symbol: sym.status === "success" ? String(sym.result) : token.slice(0, 6),
          name: nm.status === "success" ? String(nm.result) : null,
          decimals: dec.status === "success" ? Number(dec.result) : 18,
        };
        await this.prisma.tokenMetadata.upsert({
          where: { token },
          create: meta,
          update: { symbol: meta.symbol, name: meta.name, decimals: meta.decimals },
        });
        out[token] = meta;
      } catch {
        out[token] = { token, symbol: token.slice(0, 6), name: null, decimals: 18 };
      }
    }
    return out;
  }
}
