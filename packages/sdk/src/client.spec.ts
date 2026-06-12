import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MeridianClient } from "./client.js";
import { ApiError, CapabilityUnavailableError } from "./errors.js";

const BASE = "http://localhost:3000";

function makeClient() {
  return new MeridianClient({ baseUrl: BASE });
}

function stubFetch(status: number, body: unknown, isText = false) {
  const res: Partial<Response> = {
    ok: status >= 200 && status < 300,
    status,
    json: isText
      ? () => Promise.reject(new SyntaxError("not json"))
      : () => Promise.resolve(body),
    text: () => Promise.resolve(isText ? String(body) : JSON.stringify(body)),
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const validNav = {
  vaultAddress: "0xVault",
  nav: "100.0",
  confidenceLower: "99.0",
  confidenceUpper: "101.0",
  marketStatus: "regular",
  estimated: false,
  source: "chainlink",
  timestampMs: 1_717_000_000_000,
};

const validFeed = {
  items: [
    {
      vaultAddress: "0xVault",
      symbol: "mTECH",
      nav: "100.0",
      estimated: false,
      marketStatus: "regular",
      timestampMs: 1_717_000_000_000,
    },
  ],
};

const validBasketSummary = {
  vaultAddress: "0xVault",
  name: "Tech 10",
  symbol: "mTECH",
  frozen: false,
};

const validBasketDetail = {
  ...validBasketSummary,
  basketToken: null,
  cashToken: null,
  unitSize: "1000",
  constituents: [{ token: "0xA", unitQty: "10" }],
};

const validMarketPrice = {
  vaultAddress: "0xVault",
  marketPrice: "99.5",
  timestampMs: 1_717_000_000_000,
};

const validPremiumDiscount = {
  premiumBps: -50,
  nav: "100.0",
  marketPrice: "99.5",
};

const validHistoryPoint = { timestampMs: 1_717_000_000_000, nav: "100.0", estimated: false };

const validRedeemQuoteResponse = {
  assets: [{ token: "0xA", amount: "10" }],
  gateState: { gated: false, reason: "none" },
};

describe("MeridianClient — happy paths", () => {
  it("getNav parses a valid NavResponse", async () => {
    stubFetch(200, validNav);
    const client = makeClient();
    const result = await client.getNav("0xVault");
    expect(result.vaultAddress).toBe("0xVault");
    expect(result.estimated).toBe(false);
    expect(result.nav).toBe("100.0");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xVault/nav`);
  });

  it("getFeed parses a valid FeedResponse", async () => {
    stubFetch(200, validFeed);
    const result = await makeClient().getFeed();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.symbol).toBe("mTECH");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/feed`);
  });

  it("listBaskets parses a BasketSummary array", async () => {
    stubFetch(200, [validBasketSummary]);
    const result = await makeClient().listBaskets();
    expect(result).toHaveLength(1);
    expect(result[0]!.symbol).toBe("mTECH");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets`);
  });

  it("getBasket parses a BasketDetail", async () => {
    stubFetch(200, validBasketDetail);
    const result = await makeClient().getBasket("0xVault");
    expect(result.unitSize).toBe("1000");
    expect(result.constituents[0]!.unitQty).toBe("10");
  });

  it("getMarketPrice parses a MarketPrice", async () => {
    stubFetch(200, validMarketPrice);
    const result = await makeClient().getMarketPrice("0xVault");
    expect(result.marketPrice).toBe("99.5");
  });

  it("getPremiumDiscount parses a PremiumDiscount", async () => {
    stubFetch(200, validPremiumDiscount);
    const result = await makeClient().getPremiumDiscount("0xVault");
    expect(result.premiumBps).toBe(-50);
  });

  it("getHistory appends ?range= and parses a HistoryPoint array", async () => {
    stubFetch(200, [validHistoryPoint]);
    const result = await makeClient().getHistory("0xVault", "1w");
    expect(result).toHaveLength(1);
    expect(result[0]!.estimated).toBe(false);
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xVault/history?range=1w`);
  });

  it("getRedeemQuote POSTs JSON and parses the response", async () => {
    stubFetch(200, validRedeemQuoteResponse);
    const result = await makeClient().getRedeemQuote("0xVault", {
      basketTokenAmount: "1000000000000000000",
    });
    expect(result.gateState.gated).toBe(false);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xVault/redeem-quote`);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      basketTokenAmount: "1000000000000000000",
    });
  });

  it("strips a trailing slash from baseUrl", async () => {
    stubFetch(200, validFeed);
    await new MeridianClient({ baseUrl: `${BASE}/` }).getFeed();
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/feed`);
  });
});

describe("MeridianClient — error handling", () => {
  it("throws CapabilityUnavailableError on HTTP 503", async () => {
    stubFetch(503, "capability offline", true);
    await expect(makeClient().getNav("0xVault")).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it("throws ApiError on HTTP 500 with the status code", async () => {
    stubFetch(500, "internal error", true);
    const err = await makeClient()
      .getNav("0xVault")
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });

  it("throws ApiError on HTTP 404", async () => {
    stubFetch(404, "not found", true);
    const err = await makeClient()
      .getBasket("0xMissing")
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
  });

  it("throws ApiError on HTTP 401", async () => {
    stubFetch(401, "unauthorized", true);
    const err = await makeClient()
      .getFeed()
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });
});

describe("MeridianClient — zod parse failures", () => {
  it("throws on a malformed NavResponse (numeric nav instead of string)", async () => {
    stubFetch(200, { ...validNav, nav: 100.0 });
    await expect(makeClient().getNav("0xVault")).rejects.toThrow();
  });

  it("throws on a missing required field in FeedResponse", async () => {
    stubFetch(200, { items: [{ vaultAddress: "0x", symbol: "X" }] });
    await expect(makeClient().getFeed()).rejects.toThrow();
  });
});

describe("rebalance client methods", () => {
  it("getRebalanceDetail hits /baskets/:v/rebalance", async () => {
    stubFetch(200, {
      vaultAddress: "0xv",
      heldTokens: [],
      target: [],
      pendingTarget: null,
      lastRebalanceAtMs: null,
      drift: null,
    });
    const result = await makeClient().getRebalanceDetail("0xv");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xv/rebalance`);
    expect(result.vaultAddress).toBe("0xv");
  });

  it("getKeeperStatus hits /baskets/:v/keeper", async () => {
    stubFetch(200, { escrow: "0", keeperBps: 0, payouts: [] });
    const result = await makeClient().getKeeperStatus("0xv");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xv/keeper`);
    expect(result.keeperBps).toBe(0);
  });

  it("getRebalanceHistory hits /baskets/:v/rebalance/history", async () => {
    stubFetch(200, { items: [] });
    const result = await makeClient().getRebalanceHistory("0xv");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xv/rebalance/history`);
    expect(result.items).toHaveLength(0);
  });
});

describe("MeridianClient new methods", () => {
  it("getHoldings hits /baskets/:id/holdings", async () => {
    stubFetch(200, { vaultAddress: "0xv", navPerUnit: "1", estimated: false, timestampMs: 1, holdings: [] });
    const r = await makeClient().getHoldings("0xv");
    expect(r.vaultAddress).toBe("0xv");
  });

  it("buildMintTx POSTs and parses a TxPlan", async () => {
    stubFetch(200, { chainId: 46630, gate: { gated: false, reason: "none" }, steps: [], finalize: null });
    const p = await makeClient().buildMintTx("0xv", { units: "1", account: "0xo" });
    expect(p.chainId).toBe(46630);
  });

  it("getSuggestedFunds hits /catalog/suggested-funds and parses the response", async () => {
    stubFetch(200, {
      funds: [
        {
          id: "sp500", name: "S&P 500", category: "broad market", recommendedVaultKind: "registry",
          description: "SPY.", sampleHoldings: [{ symbol: "NVDA", weightBps: 842, address: "0xNVDA" }],
          holdingsCount: 442, resolvableTokens: [],
        },
      ],
    });
    const r = await makeClient().getSuggestedFunds();
    expect(r.funds[0]!.id).toBe("sp500");
    expect(r.funds[0]!.recommendedVaultKind).toBe("registry");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/catalog/suggested-funds`);
  });

  it("previewDeploy POSTs to /tx/preview-deploy and parses the response", async () => {
    stubFetch(200, {
      unitQty: ["50000000000000000000"],
      breakdown: [{ token: "0xA", symbol: "PLTR", qty: "50", valueUsd: "0", weightBps: 0 }],
      totalValueUsd: "0", priceMissing: [], predictedVault: "0xVault",
      gate: { gated: false, reason: "none" },
    });
    const p = await makeClient().previewDeploy({
      account: "0xo", vaultKind: "basket", name: "X", symbol: "X",
      tokens: ["0xA"], unitSize: "1000", composition: { mode: "quantities", qty: ["50"] },
    });
    expect(p.predictedVault).toBe("0xVault");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/tx/preview-deploy`);
    expect((init as RequestInit).method).toBe("POST");
  });
});

describe("MeridianClient forward-cash endpoints", () => {
  it("getForwardTickets hits /forward/tickets and parses", async () => {
    stubFetch(200, [
      {
        id: 0,
        vaultAddress: "0xv",
        owner: "0xo",
        kind: "create",
        amountRaw: "1000000",
        remainingRaw: "1000000",
        status: "pending",
        cutoffMs: 1,
        createdAtMs: 0,
      },
    ]);
    const out = await makeClient().getForwardTickets("0xv");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xv/forward/tickets`);
    expect(out[0]!.kind).toBe("create");
  });

  it("getForwardTickets appends ?owner when provided", async () => {
    stubFetch(200, []);
    await makeClient().getForwardTickets("0xv", "0xowner");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xv/forward/tickets?owner=0xowner`);
  });

  it("getForwardQueue parses queue + capacity", async () => {
    stubFetch(200, {
      queueAddress: "0xq",
      tickets: [],
      capacity: {
        maxCreateFlowBps: 0,
        windowCapShares: null,
        pendingCreateCash: "0",
        pendingRedeemShares: "0",
      },
    });
    const out = await makeClient().getForwardQueue("0xv");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xv/forward/queue`);
    expect(out.queueAddress).toBe("0xq");
  });

  it("getSettleGateStatus parses guards + estimated:true", async () => {
    stubFetch(200, { open: true, navPerShare: "1.0", twap: "1.0", guards: [], estimated: true });
    const out = await makeClient().getSettleGateStatus("0xv");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xv/forward/gate`);
    expect(out.estimated).toBe(true);
  });

  it("getForwardHistory parses items", async () => {
    stubFetch(200, { items: [] });
    const out = await makeClient().getForwardHistory("0xv");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${BASE}/baskets/0xv/forward/history`);
    expect(out.items).toHaveLength(0);
  });
});
