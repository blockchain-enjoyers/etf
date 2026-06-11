import { Injectable } from "@nestjs/common";
import { marketStatusFromFeedCode } from "../domain/market-status.js";
import { type OracleReading, OracleSource } from "../domain/oracle.js";
import type { OracleAdapter, TokenFeedConfig } from "./oracle-adapter.js";

/** Already-normalized 18-dec report extracted from a verified Data Streams report. */
export interface DataStreamsReport {
  price: bigint; //                  18-dec
  confidence: bigint; //             18-dec half-width band (0n if the stream has none)
  observationsTimestamp: number; //  seconds
  marketStatusCode: number; //       0-5
}

/** Thin seam over `@chainlink/data-streams-sdk` so tests inject a deterministic fake. */
export interface DataStreamsClient {
  fetchLatest(feedId: string): Promise<DataStreamsReport | undefined>;
}

@Injectable()
export class ChainlinkDataStreamsAdapter implements OracleAdapter {
  readonly source = OracleSource.Chainlink;
  private readonly feedByToken = new Map<string, string>();

  constructor(
    private readonly client: DataStreamsClient,
    feeds: TokenFeedConfig[],
  ) {
    for (const f of feeds) {
      if (f.dataStreamsFeedId) this.feedByToken.set(f.token, f.dataStreamsFeedId);
    }
  }

  async read(token: string): Promise<OracleReading | undefined> {
    const feedId = this.feedByToken.get(token);
    if (!feedId) return undefined;
    const report = await this.client.fetchLatest(feedId);
    if (!report) return undefined;
    return {
      price: report.price,
      confidence: report.confidence,
      timestamp: report.observationsTimestamp,
      marketStatus: marketStatusFromFeedCode(report.marketStatusCode),
      source: OracleSource.Chainlink,
    };
  }
}
