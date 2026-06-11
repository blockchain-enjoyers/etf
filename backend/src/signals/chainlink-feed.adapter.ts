import { Injectable } from "@nestjs/common";
import { marketStatusFromFeedCode } from "../domain/market-status.js";
import { type OracleReading, OracleSource, normalizeTo18 } from "../domain/oracle.js";
import type { OracleAdapter, TokenFeedConfig } from "./oracle-adapter.js";

/** Raw on-chain Chainlink equity feed read (IChainlinkEquityFeed.latestData). */
export interface EquityFeedData {
  price: bigint; //                  native feed decimals
  marketStatusCode: number; //       0-5
  lastSeenTimestampNs: bigint; //    nanoseconds
}

/** Seam over the viem on-chain feed read so tests inject a fake (no RPC). */
export interface EquityFeedReader {
  latestData(address: `0x${string}`): Promise<EquityFeedData>;
}

@Injectable()
export class ChainlinkFeedAdapter implements OracleAdapter {
  readonly source = OracleSource.Chainlink;
  private readonly cfgByToken = new Map<string, { address: `0x${string}`; decimals: number }>();

  constructor(
    private readonly reader: EquityFeedReader,
    feeds: TokenFeedConfig[],
  ) {
    for (const f of feeds) {
      if (f.chainlinkFeedAddress) {
        this.cfgByToken.set(f.token, {
          address: f.chainlinkFeedAddress,
          decimals: f.chainlinkFeedDecimals ?? 8,
        });
      }
    }
  }

  async read(token: string): Promise<OracleReading | undefined> {
    const cfg = this.cfgByToken.get(token);
    if (!cfg) return undefined;
    try {
      const data = await this.reader.latestData(cfg.address);
      return {
        price: normalizeTo18(data.price, cfg.decimals),
        confidence: 0n, // an aggregator feed has no native band
        timestamp: Number(data.lastSeenTimestampNs / 1_000_000_000n),
        marketStatus: marketStatusFromFeedCode(data.marketStatusCode),
        source: OracleSource.Chainlink,
      };
    } catch {
      // Degrade, don't crash: a single source failing returns undefined and the router falls through.
      return undefined;
    }
  }
}
