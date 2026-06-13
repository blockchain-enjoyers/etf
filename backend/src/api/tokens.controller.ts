import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { demoTokens } from "@meridian/contracts";
import type { TokenInfo } from "@meridian/sdk";
import { TokenMetadataService } from "../contracts/token-metadata.service.js";

const CATALOG = new Map(demoTokens.map((t) => [t.address.toLowerCase(), t]));

@Controller("tokens")
export class TokensController {
  constructor(private readonly meta: TokenMetadataService) {}

  @Get("search")
  search(@Query("q") q?: string): TokenInfo[] {
    const needle = (q ?? "").trim().toLowerCase();
    if (!needle) return [];
    return demoTokens
      .filter((t) => t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle))
      .slice(0, 20)
      .map((t) => ({ token: t.address, symbol: t.symbol, name: t.name }));
  }

  @Post("resolve")
  async resolve(@Body() body: { addresses: string[] }): Promise<TokenInfo[]> {
    const addrs = (body.addresses ?? []).map((a) => a.toLowerCase());
    const missing = addrs.filter((a) => !CATALOG.has(a));
    const onchain = missing.length ? await this.meta.getMany(missing) : {};
    return addrs.map((a) => {
      const hit = CATALOG.get(a);
      if (hit) return { token: hit.address, symbol: hit.symbol, name: hit.name };
      const m = onchain[a];
      return { token: a, symbol: m?.symbol ?? a.slice(0, 6), name: m?.name ?? null };
    });
  }
}
