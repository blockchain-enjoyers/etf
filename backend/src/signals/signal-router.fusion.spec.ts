import { describe, expect, it } from "vitest";
import { MarketStatus } from "../domain/market-status.js";
import { OracleSource } from "../domain/oracle.js";
import { MarketStatusService } from "./market-status.service.js";
import type { OracleAdapter, OracleReading } from "./oracle-adapter.js";
import { SignalRouter, type SequencerGate } from "./signal-router.js";

function adapter(source: OracleSource, price: bigint | null): OracleAdapter {
  return {
    source,
    async read(): Promise<OracleReading> {
      if (price === null) throw new Error(`${source} down`);
      return {
        price,
        confidence: price / 1000n,
        timestamp: 1_700_000_000,
        marketStatus: MarketStatus.Regular,
        source,
      };
    },
  };
}

const healthySequencer: SequencerGate = { check: async () => ({ ok: true }) };

function makeRouter(adapters: OracleAdapter[], maxDivergenceBps = 100n): SignalRouter {
  // Plan B's 5-arg constructor `(adapters, marketStatus, sequencer, clock, options)`; the fusion
  // threshold rides inside `options.maxDivergenceBps`. `fuseToReading` ignores the sequencer gate
  // (it walks all adapters directly), so a healthy stub + a fixed clock are enough for the unit test.
  return new SignalRouter(
    adapters,
    new MarketStatusService(120),
    healthySequencer,
    () => 1_700_000_000,
    { onChainSources: new Set([]), maxDivergenceBps },
  );
}

describe("SignalRouter fusion", () => {
  it("fuses two healthy agreeing sources → not estimated", async () => {
    const r = makeRouter([
      adapter(OracleSource.Chainlink, 100_000000000000000000n),
      adapter(OracleSource.Pyth, 100_300000000000000000n),
    ]);
    const out = await r.fuseToReading("0xtoken");
    expect(out.estimated ?? false).toBe(false);
    expect(out.price).toBeGreaterThan(0n);
  });

  it("flags divergence as estimated when sources disagree beyond threshold", async () => {
    const r = makeRouter([
      adapter(OracleSource.Chainlink, 100_000000000000000000n),
      adapter(OracleSource.PerpMark, 140_000000000000000000n),
    ]);
    const out = await r.fuseToReading("0xtoken");
    expect(out.estimated).toBe(true);
  });

  it("falls back to single-source reading when only one source is healthy", async () => {
    const r = makeRouter([
      adapter(OracleSource.Chainlink, 100_000000000000000000n),
      adapter(OracleSource.Pyth, null),
      adapter(OracleSource.PerpMark, null),
    ]);
    const out = await r.fuseToReading("0xtoken");
    expect(out.price).toBe(100_000000000000000000n);
    expect(out.estimated ?? false).toBe(false);
  });

  it("throws when every source is down (caller degrades to last-close)", async () => {
    const r = makeRouter([
      adapter(OracleSource.Chainlink, null),
      adapter(OracleSource.Pyth, null),
    ]);
    await expect(r.fuseToReading("0xtoken")).rejects.toThrow();
  });

  it("both Chainlink adapters (DS + on-chain feed) are reachable when stored as a list (I-1 resolved)", async () => {
    // Previously a Map<OracleSource, OracleAdapter> would silently drop the second Chainlink adapter
    // (both ChainlinkDataStreamsAdapter and ChainlinkFeedAdapter share source=OracleSource.Chainlink).
    // With the list-based storage, ALL adapters — including two with identical source values — are
    // iterated independently, so both DS and on-chain feed contribute their readings to fusion.
    const dsAdapter = adapter(OracleSource.Chainlink, 100_000000000000000000n);
    const feedAdapter: OracleAdapter = {
      source: OracleSource.Chainlink, // same source as DS — previously caused the Map collision
      async read(): Promise<OracleReading> {
        return {
          price: 100_100000000000000000n,
          confidence: 100_100000000000000000n / 1000n,
          timestamp: 1_700_000_000,
          marketStatus: MarketStatus.Regular,
          source: OracleSource.Chainlink,
        };
      },
    };
    const pythAdapter = adapter(OracleSource.Pyth, 99_900000000000000000n);
    const r = makeRouter([dsAdapter, feedAdapter, pythAdapter]);
    // All three readings should be gathered (including both Chainlink entries);
    // median of [99.9e18, 100e18, 100.1e18] = 100e18
    const out = await r.fuseToReading("0xtoken");
    expect(out.price).toBe(100_000000000000000000n);
    expect(out.estimated ?? false).toBe(false);
  });
});
