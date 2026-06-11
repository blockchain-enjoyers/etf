import { describe, expect, it } from "vitest";
import { MarketStatus } from "../domain/market-status.js";
import { type OracleReading, OracleSource } from "../domain/oracle.js";
import { MarketStatusService } from "./market-status.service.js";
import type { OracleAdapter } from "./oracle-adapter.js";
import { SignalRouter, type SequencerGate } from "./signal-router.js";

const NOW = 1_750_000_000;

function reading(over: Partial<OracleReading> = {}): OracleReading {
  return {
    price: 100_000_000_000_000_000_000n,
    confidence: 0n,
    timestamp: NOW - 1,
    marketStatus: MarketStatus.Regular,
    source: OracleSource.Chainlink,
    ...over,
  };
}

function adapter(source: OracleSource, impl: (t: string) => Promise<OracleReading | undefined>): OracleAdapter {
  return { source, read: impl };
}

const healthySequencer: SequencerGate = { check: async () => ({ ok: true }) };
const downSequencer: SequencerGate = { check: async () => ({ ok: false, reason: "SequencerDown" }) };

function router(adapters: OracleAdapter[], seq: SequencerGate = healthySequencer): SignalRouter {
  return new SignalRouter(adapters, new MarketStatusService(120), seq, () => NOW, {
    onChainSources: new Set([OracleSource.Chainlink]),
  });
}

describe("SignalRouter", () => {
  it("OPEN: returns the first source (Chainlink) when it has a fresh Regular reading", async () => {
    const r = router([
      adapter(OracleSource.Chainlink, async () => reading()),
      adapter(OracleSource.Pyth, async () => reading({ source: OracleSource.Pyth })),
    ]);
    const out = await r.getReading("0xTOK");
    expect(out.source).toBe(OracleSource.Chainlink);
    expect(out.estimated).toBe(false);
  });

  it("FALLBACK: when Chainlink returns nothing, falls through to Pyth", async () => {
    const r = router([
      adapter(OracleSource.Chainlink, async () => undefined),
      adapter(OracleSource.Pyth, async () => reading({ source: OracleSource.Pyth })),
    ]);
    const out = await r.getReading("0xTOK");
    expect(out.source).toBe(OracleSource.Pyth);
  });

  it("FALLBACK on throw: a source that rejects is skipped, not fatal", async () => {
    const r = router([
      adapter(OracleSource.Chainlink, async () => {
        throw new Error("DS 500");
      }),
      adapter(OracleSource.Pyth, async () => reading({ source: OracleSource.Pyth })),
    ]);
    const out = await r.getReading("0xTOK");
    expect(out.source).toBe(OracleSource.Pyth);
  });

  it("SEQUENCER-DOWN: an on-chain source is skipped when the sequencer is down", async () => {
    const r = router(
      [
        adapter(OracleSource.Chainlink, async () => reading()),
        adapter(OracleSource.Pyth, async () => reading({ source: OracleSource.Pyth })),
      ],
      downSequencer,
    );
    const out = await r.getReading("0xTOK");
    // Chainlink is on-chain-gated → skipped; Pyth (off-chain) wins.
    expect(out.source).toBe(OracleSource.Pyth);
  });

  it("ALL-DEGRADED: when only a stale Closed reading exists, returns it marked estimated", async () => {
    const r = router([
      adapter(OracleSource.Chainlink, async () =>
        reading({ marketStatus: MarketStatus.Closed, timestamp: NOW - 3 * 24 * 3600 }),
      ),
    ]);
    const out = await r.getReading("0xTOK");
    expect(out.estimated).toBe(true);
    expect(out.marketStatus).toBe(MarketStatus.Closed);
  });

  it("NO-SOURCE: synthesizes a LastClose Unknown estimated reading when nothing is usable", async () => {
    const r = router([adapter(OracleSource.Chainlink, async () => undefined)]);
    const out = await r.getReading("0xTOK");
    expect(out.source).toBe(OracleSource.LastClose);
    expect(out.estimated).toBe(true);
    expect(out.marketStatus).toBe(MarketStatus.Unknown);
  });
});
