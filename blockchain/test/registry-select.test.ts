import { expect } from "chai";
import {
  selectTopN,
  syntheticPriceUsd,
  loadRegistry,
} from "../scripts/deploy/lib/registry-select";

describe("registry-select", () => {
  const tokens = [
    { ticker: "BIG",   underlying: { market_cap_usd: 1_000_000_000 }, onchain: { total_supply: "10000000.0" }, deployments: [{ token_symbol: "BIG" }] },
    { ticker: "SMALL", underlying: { market_cap_usd: 5_000_000 },    onchain: { total_supply: "1000000.0" },  deployments: [{ token_symbol: "SMALL" }] },
    { ticker: "MID",   underlying: { market_cap_usd: 50_000_000 },   onchain: { total_supply: "2000000.0" },  deployments: [{ token_symbol: "MID" }] },
  ];

  it("returns top-N by market cap, descending", () => {
    const out = selectTopN(tokens as any, 2);
    expect(out.map((t) => t.ticker)).to.deep.equal(["BIG", "MID"]);
  });

  it("derives synthetic price = market_cap / total_supply", () => {
    expect(syntheticPriceUsd(tokens[0] as any)).to.equal(100); // 1e9 / 1e7
  });

  it("clamps price to a 0.01 floor when supply is huge / cap tiny", () => {
    const t = { underlying: { market_cap_usd: 1 }, onchain: { total_supply: "1000000000.0" } };
    expect(syntheticPriceUsd(t as any)).to.equal(0.01);
  });

  it("falls back to ticker as symbol when deployments is empty", () => {
    const tokens = [
      { ticker: "NODEP", underlying: { market_cap_usd: 100 }, onchain: { total_supply: "10.0" } },
      { ticker: "HASDEP", underlying: { market_cap_usd: 50 }, onchain: { total_supply: "5.0" }, deployments: [{ token_symbol: "HSYM" }] },
    ];
    const out = selectTopN(tokens as any, 2);
    expect(out.find((t) => t.ticker === "NODEP")!.symbol).to.equal("NODEP");
    expect(out.find((t) => t.ticker === "HASDEP")!.symbol).to.equal("HSYM");
  });

  it("loadRegistry reads the real registry file (1995 tokens)", () => {
    const reg = loadRegistry();
    expect(reg.length).to.be.greaterThan(100);
  });
});
