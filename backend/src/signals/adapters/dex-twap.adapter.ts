import { Injectable } from "@nestjs/common";
import { MarketStatus } from "../../domain/market-status.js";
import { OracleSource } from "../../domain/oracle.js";
import type { OracleAdapter, OracleReading } from "../oracle-adapter.js";

/** Minimal DEX TWAP reader (real impl reads a Uniswap-v3-style pool via viem; tests fake it). */
export interface DexTwapReader {
  readTwap(token: `0x${string}`): Promise<{ twap: bigint; liquidity: bigint; updatedAt: number }>;
}

export interface DexTwapOptions {
  /** Below this in-range liquidity, the TWAP is untrustworthy → degrade. */
  minLiquidity: bigint;
}

@Injectable()
export class DexTwapAdapter implements OracleAdapter {
  readonly source = OracleSource.DexTwap;

  constructor(
    private readonly reader: DexTwapReader,
    private readonly options: DexTwapOptions,
  ) {}

  async read(token: string): Promise<OracleReading> {
    const { twap, liquidity, updatedAt } = await this.reader.readTwap(token as `0x${string}`);
    const thin = liquidity < this.options.minLiquidity;
    return {
      price: twap,
      // Confidence proxy: wider when the pool is thin.
      confidence: thin ? twap / 20n : twap / 200n,
      timestamp: updatedAt,
      marketStatus: thin ? MarketStatus.Closed : MarketStatus.Regular,
      source: OracleSource.DexTwap,
    };
  }
}
