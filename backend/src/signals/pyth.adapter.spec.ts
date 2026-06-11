import { describe, expect, it } from "vitest";
import { MarketStatus } from "../domain/market-status.js";
import { OracleSource } from "../domain/oracle.js";
import { PythAdapter, type PythHermes, type PythPrice } from "./pyth.adapter.js";

function hermes(price?: PythPrice): PythHermes {
  return { getLatestPrice: async () => price };
}

const feeds = [{ token: "0xTOK", pythPriceId: "0xpyth" }];

describe("PythAdapter", () => {
  it("normalizes a Pyth expo-scaled price (expo -8) to 18-dec and keeps Pyth status", async () => {
    // 150.00 with expo -8 => mantissa 15_000_000_000
    const adapter = new PythAdapter(
      hermes({ price: 15_000_000_000n, conf: 5_000_000n, expo: -8, publishTime: 1_750_000_000 }),
      feeds,
      () => MarketStatus.Regular,
    );
    const r = await adapter.read("0xTOK");
    expect(r?.price).toBe(150_000_000_000_000_000_000n);
    expect(r?.confidence).toBe(50_000_000_000_000_000n); // 0.05 * 1e18 (conf=5_000_000n at expo -8)
    expect(r?.marketStatus).toBe(MarketStatus.Regular);
    expect(r?.source).toBe(OracleSource.Pyth);
  });

  it("returns undefined for an unconfigured token", async () => {
    const adapter = new PythAdapter(hermes(), feeds, () => MarketStatus.Regular);
    expect(await adapter.read("0xNOPE")).toBeUndefined();
  });

  it("returns undefined when hermes has no price", async () => {
    const adapter = new PythAdapter(hermes(undefined), feeds, () => MarketStatus.Regular);
    expect(await adapter.read("0xTOK")).toBeUndefined();
  });

  it("resolves a mixed-case token lookup against a lowercase-keyed feed", async () => {
    const lowercaseFeeds = [{ token: "0xabcdef1234567890abcdef1234567890abcdef12", pythPriceId: "0xpyth" }];
    const adapter = new PythAdapter(
      hermes({ price: 10_000_000_000n, conf: 1_000_000n, expo: -8, publishTime: 1_750_000_000 }),
      lowercaseFeeds,
      () => MarketStatus.Regular,
    );
    // Read with mixed-case token — should still resolve
    const r = await adapter.read("0xABCDEF1234567890ABCDEF1234567890ABCDEF12");
    expect(r).toBeDefined();
    expect(r?.price).toBe(100_000_000_000_000_000_000n);
    expect(r?.source).toBe(OracleSource.Pyth);
  });
});
