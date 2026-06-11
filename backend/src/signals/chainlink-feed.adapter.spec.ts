import { describe, expect, it } from "vitest";
import { MarketStatus } from "../domain/market-status.js";
import { OracleSource } from "../domain/oracle.js";
import { ChainlinkFeedAdapter, type EquityFeedReader } from "./chainlink-feed.adapter.js";

const feeds = [
  {
    token: "0xTOK",
    chainlinkFeedAddress: "0x00000000000000000000000000000000000000aa" as `0x${string}`,
    chainlinkFeedDecimals: 8,
  },
];

describe("ChainlinkFeedAdapter", () => {
  it("normalizes an 8-dec on-chain feed price up to 18-dec", async () => {
    const reader: EquityFeedReader = {
      latestData: async () => ({
        price: 15_000_000_000n, // 150.00 at 8-dec
        marketStatusCode: 2,
        lastSeenTimestampNs: 1_750_000_000_000_000_000n,
      }),
    };
    const adapter = new ChainlinkFeedAdapter(reader, feeds);
    const r = await adapter.read("0xTOK");
    expect(r?.price).toBe(150_000_000_000_000_000_000n);
    expect(r?.timestamp).toBe(1_750_000_000); // ns → s
    expect(r?.marketStatus).toBe(MarketStatus.Regular);
    expect(r?.source).toBe(OracleSource.Chainlink);
  });

  it("returns undefined for an unconfigured token", async () => {
    const reader: EquityFeedReader = {
      latestData: async () => ({ price: 1n, marketStatusCode: 2, lastSeenTimestampNs: 0n }),
    };
    const adapter = new ChainlinkFeedAdapter(reader, feeds);
    expect(await adapter.read("0xNOPE")).toBeUndefined();
  });

  it("returns undefined (degrades) when the on-chain read rejects", async () => {
    const reader: EquityFeedReader = {
      latestData: async () => {
        throw new Error("rpc down");
      },
    };
    const adapter = new ChainlinkFeedAdapter(reader, feeds);
    expect(await adapter.read("0xTOK")).toBeUndefined();
  });
});
