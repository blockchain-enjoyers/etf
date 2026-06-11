import { Injectable } from "@nestjs/common";
import type { MarketStatus } from "../domain/market-status.js";
import { type OracleReading, OracleSource, normalizeTo18 } from "../domain/oracle.js";
import type { OracleAdapter, TokenFeedConfig } from "./oracle-adapter.js";

/** A Pyth price feed point (mantissa + base-10 exponent), as Hermes returns it. */
export interface PythPrice {
  price: bigint; //        mantissa
  conf: bigint; //         confidence mantissa
  expo: number; //         base-10 exponent (typically negative, e.g. -8)
  publishTime: number; //  seconds
}

/** Seam over `@pythnetwork/hermes-client` so tests inject a fake. */
export interface PythHermes {
  getLatestPrice(priceId: string): Promise<PythPrice | undefined>;
}

/** Pyth carries no equities marketStatus; the FSM supplies it from clock/anchor. */
export type MarketStatusProvider = () => MarketStatus;

@Injectable()
export class PythAdapter implements OracleAdapter {
  readonly source = OracleSource.Pyth;
  private readonly idByToken = new Map<string, string>();

  constructor(
    private readonly hermes: PythHermes,
    feeds: TokenFeedConfig[],
    private readonly statusProvider: MarketStatusProvider,
  ) {
    for (const f of feeds) {
      if (f.pythPriceId) this.idByToken.set(f.token.toLowerCase(), f.pythPriceId);
    }
  }

  async read(token: string): Promise<OracleReading | undefined> {
    const priceId = this.idByToken.get(token.toLowerCase());
    if (!priceId) return undefined;
    const p = await this.hermes.getLatestPrice(priceId);
    if (!p) return undefined;
    // Pyth mantissa is at 10^expo; normalizeTo18 expects "decimals" = -expo.
    const decimals = -p.expo;
    return {
      price: normalizeTo18(p.price, decimals),
      confidence: normalizeTo18(p.conf, decimals),
      timestamp: p.publishTime,
      marketStatus: this.statusProvider(),
      source: OracleSource.Pyth,
    };
  }
}
