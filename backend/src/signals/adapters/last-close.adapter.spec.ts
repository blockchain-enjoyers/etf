import { describe, expect, it, vi } from "vitest";
import { MarketStatus } from "../../domain/market-status.js";
import { OracleSource } from "../../domain/oracle.js";
import { LastCloseAdapter } from "./last-close.adapter.js";

const ANCHOR = { price: 300_000000000000000000n, timestampSec: 1_780_000_000 }; // $300, 18-dec
function make(status: MarketStatus, anchor: typeof ANCHOR | undefined = ANCHOR, nowSec = 1_780_100_000) {
  const anchors = { lastRegular: vi.fn().mockResolvedValue(anchor) };
  const a = new LastCloseAdapter(anchors as never, () => status, () => nowSec, { maxDriftBps: 50, bandBps: 200 });
  return { a, anchors };
}

describe("LastCloseAdapter", () => {
  it("no anchor → undefined (nothing invented)", async () => {
    const anchors = { lastRegular: vi.fn().mockResolvedValue(undefined) };
    const a = new LastCloseAdapter(anchors as never, () => MarketStatus.Closed, () => 1_780_100_000, { maxDriftBps: 50, bandBps: 200 });
    expect(await a.read("0xa")).toBeUndefined();
  });

  it("closed market → bounded deterministic walk around the anchor, fresh timestamp", async () => {
    const { a } = make(MarketStatus.Closed);
    const r1 = await a.read("0xa");
    const r2 = await a.read("0xa");
    expect(r1!.price).toEqual(r2!.price); // deterministic at the same clock
    const bps = ((r1!.price > ANCHOR.price ? r1!.price - ANCHOR.price : ANCHOR.price - r1!.price) * 10_000n) / ANCHOR.price;
    expect(bps <= 50n).toBe(true);
    expect(r1!.marketStatus).toBe(MarketStatus.Closed);
    expect(r1!.source).toBe(OracleSource.LastClose);
    expect(r1!.timestamp).toBe(1_780_100_000);
    expect(r1!.confidence).toBe((r1!.price * 200n) / 10_000n);
  });

  it("walk moves over time and differs per token", async () => {
    const { a } = make(MarketStatus.Closed);
    const { a: later } = make(MarketStatus.Closed, ANCHOR, 1_780_103_000);
    expect((await a.read("0xa"))!.price).not.toEqual((await later.read("0xa"))!.price);
    expect((await a.read("0xa1"))!.price).not.toEqual((await a.read("0xb2"))!.price);
  });

  it("Regular (feeds down) → flat anchor with the anchor's STALE timestamp", async () => {
    const { a } = make(MarketStatus.Regular);
    const r = await a.read("0xa");
    expect(r!.price).toBe(ANCHOR.price);
    expect(r!.timestamp).toBe(ANCHOR.timestampSec); // stale ⇒ FSM degrades it downstream
  });
});
