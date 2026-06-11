import { describe, it, expect } from "vitest";
import { FixtureApi } from "../fixture-api";
import { VAULT_CLOSED, VAULT_OPEN } from "../data";

const api = new FixtureApi();

describe("FixtureApi.listBaskets", () => {
  it("returns at least 4 baskets", async () => {
    const baskets = await api.listBaskets();
    expect(baskets.length).toBeGreaterThanOrEqual(4);
  });

  it("includes the open basket (UTECH10)", async () => {
    const baskets = await api.listBaskets();
    const open = baskets.find((b) => b.vaultAddress === VAULT_OPEN);
    expect(open).toBeDefined();
    expect(open!.symbol).toBe("UTECH10");
    expect(open!.frozen).toBe(false);
  });

  it("includes the closed basket (GMACRO)", async () => {
    const baskets = await api.listBaskets();
    const closed = baskets.find((b) => b.vaultAddress === VAULT_CLOSED);
    expect(closed).toBeDefined();
    expect(closed!.symbol).toBe("GMACRO");
  });
});

describe("FixtureApi.getNav — closed basket (estimated flag)", () => {
  it("returns estimated true for the closed basket", async () => {
    const nav = await api.getNav(VAULT_CLOSED);
    expect(nav.estimated).toBe(true);
    expect(nav.marketStatus).toBe("closed");
  });

  it("returns estimated false for the open basket", async () => {
    const nav = await api.getNav(VAULT_OPEN);
    expect(nav.estimated).toBe(false);
    expect(nav.marketStatus).toBe("regular");
  });

  it("has a wide confidence band (upper - lower > $5 in 18-dec)", async () => {
    const nav = await api.getNav(VAULT_CLOSED);
    const lower = BigInt(nav.confidenceLower);
    const upper = BigInt(nav.confidenceUpper);
    const fiveDollars = BigInt("5000000000000000000");
    expect(upper - lower).toBeGreaterThan(fiveDollars);
  });
});

describe("FixtureApi.getRedeemQuote — iron rule", () => {
  it("never gates in-kind redeem for the closed basket", async () => {
    const quote = await api.getRedeemQuote(VAULT_CLOSED, {
      basketTokenAmount: "1000000000000000000",
    });
    expect(quote.gateState.gated).toBe(false);
    expect(quote.gateState.reason).toBe("none");
  });

  it("never gates in-kind redeem for the open basket", async () => {
    const quote = await api.getRedeemQuote(VAULT_OPEN, {
      basketTokenAmount: "1000000000000000000",
    });
    expect(quote.gateState.gated).toBe(false);
    expect(quote.gateState.reason).toBe("none");
  });
});

describe("FixtureApi.getHistory", () => {
  it("returns 24 data points for the open basket", async () => {
    const history = await api.getHistory(VAULT_OPEN, "1d");
    expect(history.length).toBe(24);
  });

  it("all closed-basket history points carry estimated true", async () => {
    const history = await api.getHistory(VAULT_CLOSED, "1d");
    expect(history.every((p) => p.estimated === true)).toBe(true);
  });
});

describe("FixtureApi.getFeed", () => {
  it("returns 4 feed items", async () => {
    const feed = await api.getFeed();
    expect(feed.items.length).toBe(4);
  });

  it("closed basket feed item carries estimated true", async () => {
    const feed = await api.getFeed();
    const item = feed.items.find((i) => i.vaultAddress === VAULT_CLOSED);
    expect(item?.estimated).toBe(true);
    expect(item?.marketStatus).toBe("closed");
  });
});
