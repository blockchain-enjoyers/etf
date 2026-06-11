import { describe, expect, it } from "vitest";
import { MarketStatus } from "../domain/market-status.js";
import { OracleSource } from "../domain/oracle.js";
import {
  ChainlinkDataStreamsAdapter,
  type DataStreamsClient,
  type DataStreamsReport,
} from "./chainlink-data-streams.adapter.js";

function fakeClient(report?: DataStreamsReport): DataStreamsClient {
  return { fetchLatest: async () => report };
}

const feeds = [{ token: "0xTOK", dataStreamsFeedId: "0xfeed" }];

describe("ChainlinkDataStreamsAdapter", () => {
  it("normalizes an 18-dec Data Streams report into a Regular reading", async () => {
    const adapter = new ChainlinkDataStreamsAdapter(
      fakeClient({
        price: 200_000_000_000_000_000_000n,
        confidence: 500_000_000_000_000_000n,
        observationsTimestamp: 1_750_000_000,
        marketStatusCode: 2,
      }),
      feeds,
    );
    const r = await adapter.read("0xTOK");
    expect(r?.price).toBe(200_000_000_000_000_000_000n);
    expect(r?.confidence).toBe(500_000_000_000_000_000n);
    expect(r?.marketStatus).toBe(MarketStatus.Regular);
    expect(r?.source).toBe(OracleSource.Chainlink);
  });

  it("returns undefined for a token with no configured feed id", async () => {
    const adapter = new ChainlinkDataStreamsAdapter(fakeClient(), feeds);
    expect(await adapter.read("0xUNKNOWN")).toBeUndefined();
  });

  it("returns undefined when the client has no report (degrade, don't throw)", async () => {
    const adapter = new ChainlinkDataStreamsAdapter(fakeClient(undefined), feeds);
    expect(await adapter.read("0xTOK")).toBeUndefined();
  });

  it("maps a weekend Closed report (code 5) to Closed", async () => {
    const adapter = new ChainlinkDataStreamsAdapter(
      fakeClient({
        price: 200_000_000_000_000_000_000n,
        confidence: 0n,
        observationsTimestamp: 1_749_000_000,
        marketStatusCode: 5,
      }),
      feeds,
    );
    const r = await adapter.read("0xTOK");
    expect(r?.marketStatus).toBe(MarketStatus.Closed);
  });
});
