import { Injectable } from "@nestjs/common";
import { MarketStatus } from "../../domain/market-status.js";
import { OracleSource } from "../../domain/oracle.js";
import type { OracleAdapter, OracleReading } from "../oracle-adapter.js";

/** Minimal perpetual-futures mark reader (real impl reads a perp venue; tests fake it). */
export interface PerpMarkReader {
  readMark(token: `0x${string}`): Promise<{ mark: bigint; fundingStale: boolean; updatedAt: number }>;
}

@Injectable()
export class PerpMarkAdapter implements OracleAdapter {
  readonly source = OracleSource.PerpMark;

  constructor(private readonly reader: PerpMarkReader) {}

  async read(token: string): Promise<OracleReading> {
    const { mark, fundingStale, updatedAt } = await this.reader.readMark(token as `0x${string}`);
    return {
      price: mark,
      confidence: fundingStale ? mark / 25n : mark / 250n,
      timestamp: updatedAt,
      // Perp mark covers overnight/closed equity sessions; stale funding → degrade.
      marketStatus: fundingStale ? MarketStatus.Closed : MarketStatus.Overnight,
      source: OracleSource.PerpMark,
    };
  }
}
