import { describe, expect, it } from "vitest";
import {
  basketDetailSchema,
  basketSummarySchema,
  constituentDtoSchema,
  demoSeriesSchema,
  marketStatusSchema,
  navResponseSchema,
  oracleSourceSchema,
  premiumDiscountSchema,
  redeemQuoteRequestSchema,
  redeemQuoteResponseSchema,
  vaultTypeSchema,
  oracleSeveritySchema,
  rebalanceDetailSchema,
  keeperStatusSchema,
  rebalanceHistorySchema,
  forwardTicketSchema,
  settleGateStatusSchema,
  queueCapacitySchema,
  forwardQueueSchema,
  forwardHistorySchema,
  holdingRowSchema,
  holdingsResponseSchema,
  accountHoldingsResponseSchema,
  availabilityResponseSchema,
  txActionSchema,
  mintQuoteResponseSchema,
  txPlanSchema,
  txStepSchema,
  auctionOpenTxRequestSchema,
  auctionBidTxRequestSchema,
  auctionStatusSchema,
  previewDeployRequestSchema,
  previewDeployResponseSchema,
  suggestedFundsResponseSchema,
  registryWrapTxRequestSchema,
  registryBatchWrapTxRequestSchema,
  registryUnwrapTxRequestSchema,
  registrySetOperatorTxRequestSchema,
  registryBootstrapTxRequestSchema,
  registryCreateTxRequestSchema,
  registryRedeemTxRequestSchema,
} from "./dto.js";

describe("sdk DTO schemas", () => {
  it("accepts a valid NavResponse keyed on vaultAddress and infers string-encoded decimals", () => {
    const parsed = navResponseSchema.parse({
      vaultAddress: "0xabc",
      nav: "123.456789012345678901",
      confidenceLower: "120.0",
      confidenceUpper: "126.0",
      marketStatus: "regular",
      estimated: true,
      source: "chainlink",
      timestampMs: 1_717_000_000_000,
    });
    expect(parsed.vaultAddress).toBe("0xabc");
    expect(parsed.nav).toBe("123.456789012345678901");
    expect(parsed.estimated).toBe(true);
  });

  it("rejects a NavResponse with a numeric (non-string) nav", () => {
    expect(() =>
      navResponseSchema.parse({
        vaultAddress: "0xabc",
        nav: 123.45,
        confidenceLower: "120.0",
        confidenceUpper: "126.0",
        marketStatus: "regular",
        estimated: false,
        source: "chainlink",
        timestampMs: 1,
      }),
    ).toThrow();
  });

  it("rejects an unknown marketStatus / source enum value", () => {
    expect(() => marketStatusSchema.parse("halted")).toThrow();
    expect(() => oracleSourceSchema.parse("uniswap")).toThrow();
  });

  it("validates the redeem-quote request and gated response", () => {
    const req = redeemQuoteRequestSchema.parse({ basketTokenAmount: "1000000000000000000" });
    expect(req.basketTokenAmount).toBe("1000000000000000000");
    const res = redeemQuoteResponseSchema.parse({
      assets: [{ token: "0xt", amount: "5" }],
      gateState: { gated: true, reason: "estimated" },
    });
    expect(res.gateState.gated).toBe(true);
  });

  it("validates basket summary keyed on vaultAddress, premium/discount and demo series", () => {
    expect(
      basketSummarySchema.parse({
        vaultAddress: "0xv",
        name: "Tech 10",
        symbol: "mTECH",
        frozen: false,
      }).symbol,
    ).toBe("mTECH");
    expect(premiumDiscountSchema.parse({ premiumBps: -42, nav: "1", marketPrice: "0.99" }).premiumBps).toBe(-42);
    expect(
      demoSeriesSchema.parse({ id: "weekend-gap", event: "weekend", name: "Weekend Gap", frames: [{ t: 0, v: "1" }] })
        .frames.length,
    ).toBe(1);
  });

  it("constituent DTO is {token, unitQty} only — weightBps/decimals are gone", () => {
    const c = constituentDtoSchema.parse({ token: "0xA", unitQty: "10" });
    expect(c).toEqual({ token: "0xA", unitQty: "10" });
    // unknown keys are stripped, not errors — assert the shape has no weightBps surviving.
    expect("weightBps" in c).toBe(false);
  });

  it("basketDetail carries unitSize and a vaultAddress identity", () => {
    const d = basketDetailSchema.parse({
      vaultAddress: "0xv",
      name: "Tech",
      symbol: "mTECH",
      frozen: false,
      basketToken: null,
      cashToken: null,
      unitSize: "1000",
      constituents: [{ token: "0xA", unitQty: "10" }],
    });
    expect(d.vaultAddress).toBe("0xv");
    expect(d.unitSize).toBe("1000");
    expect(d.constituents[0]!.unitQty).toBe("10");
  });
});

describe("vault type + nav severity DTO additions", () => {
  it("vaultTypeSchema accepts every vault type", () => {
    for (const t of ["basket", "managed", "committed", "rebalance", "registry"])
      expect(vaultTypeSchema.parse(t)).toBe(t);
    expect(() => vaultTypeSchema.parse("nope")).toThrow();
  });
  it("oracleSeveritySchema mirrors the on-chain 5-value enum", () => {
    for (const s of ["open", "degraded", "halted", "closed", "unknown"]) expect(oracleSeveritySchema.parse(s)).toBe(s);
  });
  it("basketSummary defaults vaultType to basket and allows managed fields", () => {
    const base = { vaultAddress: "0x1", name: "N", symbol: "S", frozen: false };
    expect(basketSummarySchema.parse(base).vaultType).toBe("basket");
    const managed = basketSummarySchema.parse({ ...base, vaultType: "managed", manager: "0xabc", managerFeeBps: 100, platformFeeBps: 15 });
    expect(managed.manager).toBe("0xabc");
    expect(managed.managerFeeBps).toBe(100);
    expect(managed.platformFeeBps).toBe(15);
  });
  it("basketSummary carries platformFeeBps and accepts null (deployed impl predates the getter)", () => {
    const base = { vaultAddress: "0x1", name: "N", symbol: "S", frozen: false };
    expect(basketSummarySchema.parse({ ...base, platformFeeBps: null }).platformFeeBps).toBeNull();
    // absent is allowed (optional); basket/committed vaults carry no platform fee.
    expect(basketSummarySchema.parse(base).platformFeeBps).toBeUndefined();
  });
  it("basketDetail carries recipeCommitment", () => {
    const detail = basketDetailSchema.parse({
      vaultAddress: "0x1", name: "N", symbol: "S", frozen: false, basketToken: null, cashToken: null,
      unitSize: "1000000000000000000", constituents: [], recipeCommitment: "0xdead",
    });
    expect(detail.recipeCommitment).toBe("0xdead");
  });
  it("navResponse carries optional severity + safe", () => {
    const nav = navResponseSchema.parse({
      vaultAddress: "0x1", nav: "1", confidenceLower: "0", confidenceUpper: "2",
      marketStatus: "regular", estimated: false, source: "chainlink", timestampMs: 1, severity: "open", safe: true,
    });
    expect(nav.severity).toBe("open"); expect(nav.safe).toBe(true);
  });
});

describe("rebalance DTOs", () => {
  it("parses rebalanceDetail with null pendingTarget + null drift", () => {
    const r = rebalanceDetailSchema.parse({
      vaultAddress: "0xv",
      heldTokens: [{ token: "0xt", balance: "5" }],
      target: [{ token: "0xt", unitQty: "1" }],
      pendingTarget: null,
      lastRebalanceAtMs: null,
      drift: null,
    });
    expect(r.heldTokens[0]!.balance).toBe("5");
    expect(r.pendingTarget).toBeNull();
    expect(r.totalSupply).toBeUndefined();
  });

  it("round-trips optional totalSupply on rebalanceDetail", () => {
    const r = rebalanceDetailSchema.parse({
      vaultAddress: "0xv",
      heldTokens: [{ token: "0xt", balance: "5" }],
      target: [{ token: "0xt", unitQty: "1" }],
      pendingTarget: null,
      lastRebalanceAtMs: null,
      drift: null,
      totalSupply: "1000",
    });
    expect(r.totalSupply).toBe("1000");
  });

  it("parses keeperStatus + rebalanceHistory", () => {
    const k = keeperStatusSchema.parse({
      escrow: "12",
      keeperBps: 1000,
      payouts: [{ to: "0xa", amount: "3", txHash: "0xh", timestampMs: 1 }],
    });
    expect(k.payouts).toHaveLength(1);
    const h = rebalanceHistorySchema.parse({
      items: [
        {
          txHash: "0xh",
          blockNumber: 9,
          recipient: "0xr",
          acquire: [{ token: "0xa", amount: "1" }],
          release: [{ token: "0xb", amount: "2" }],
          timestampMs: 5,
        },
      ],
    });
    expect(h.items[0]!.acquire[0]!.token).toBe("0xa");
  });
});

describe("rebalance vault type", () => {
  it("accepts 'rebalance' as a vault type", () => {
    expect(vaultTypeSchema.parse("rebalance")).toBe("rebalance");
  });

  it("parses keeper fields on basketDetail", () => {
    const d = basketDetailSchema.parse({
      vaultAddress: "0xvault",
      name: "R",
      symbol: "R",
      frozen: false,
      vaultType: "rebalance",
      basketToken: null,
      cashToken: null,
      unitSize: "1000",
      constituents: [],
      keeperBps: 1000,
      keeperEscrow: "0xkeeper",
    });
    expect(d.keeperBps).toBe(1000);
    expect(d.keeperEscrow).toBe("0xkeeper");
  });
});

describe("forward-cash (L5) DTOs", () => {
  it("parses a create ticket (6-dec USDC raw) and a redeem ticket (18-dec shares raw)", () => {
    const create = forwardTicketSchema.parse({
      id: 0,
      vaultAddress: "0xv",
      owner: "0xo",
      kind: "create",
      amountRaw: "1000000",
      remainingRaw: "1000000",
      status: "pending",
      cutoffMs: 1_717_000_000_000,
      createdAtMs: 1_716_000_000_000,
    });
    expect(create.kind).toBe("create");
    expect(create.amountRaw).toBe("1000000");
    const redeem = forwardTicketSchema.parse({
      id: 1,
      vaultAddress: "0xv",
      owner: "0xo",
      kind: "redeem",
      amountRaw: "1000000000000000000",
      remainingRaw: "500000000000000000",
      status: "partial",
      cutoffMs: 1,
      createdAtMs: 0,
    });
    expect(redeem.status).toBe("partial");
    expect(redeem.remainingRaw).toBe("500000000000000000");
  });

  it("rejects an unknown ticket kind / status", () => {
    expect(() =>
      forwardTicketSchema.parse({
        id: 0, vaultAddress: "0xv", owner: "0xo", kind: "swap",
        amountRaw: "1", remainingRaw: "1", status: "pending", cutoffMs: 0, createdAtMs: 0,
      }),
    ).toThrow();
    expect(() =>
      forwardTicketSchema.parse({
        id: 0, vaultAddress: "0xv", owner: "0xo", kind: "create",
        amountRaw: "1", remainingRaw: "1", status: "failed", cutoffMs: 0, createdAtMs: 0,
      }),
    ).toThrow();
  });

  it("settleGateStatus forces estimated:true and reports per-guard ok/reason", () => {
    const gate = settleGateStatusSchema.parse({
      open: false,
      navPerShare: null,
      twap: "1.05",
      guards: [
        { id: "g0", ok: true, reason: null },
        { id: "g2", ok: false, reason: "NotOpen" },
      ],
      estimated: true,
    });
    expect(gate.open).toBe(false);
    expect(gate.estimated).toBe(true);
    expect(gate.guards[1]!.reason).toBe("NotOpen");
  });

  it("settleGateStatus rejects estimated:false (IRON RULE literal)", () => {
    expect(() =>
      settleGateStatusSchema.parse({
        open: true, navPerShare: "1.0", twap: "1.0", guards: [], estimated: false,
      }),
    ).toThrow();
  });

  it("queueCapacity null when uncapped, shares/cash when capped", () => {
    const uncapped = queueCapacitySchema.parse({
      maxCreateFlowBps: 0, windowCapShares: null, pendingCreateCash: "1000000", pendingRedeemShares: "0",
    });
    expect(uncapped.windowCapShares).toBeNull();
    expect(uncapped.pendingCreateCash).toBe("1000000");
    const capped = queueCapacitySchema.parse({
      maxCreateFlowBps: 500, windowCapShares: "5000000000000000000",
      pendingCreateCash: "1000000", pendingRedeemShares: "0",
    });
    expect(capped.maxCreateFlowBps).toBe(500);
    expect(capped.windowCapShares).toBe("5000000000000000000");
    expect(capped.pendingRedeemShares).toBe("0");
  });

  it("forwardQueue bundles tickets + capacity (queueAddress null when undeployed)", () => {
    const q = forwardQueueSchema.parse({
      queueAddress: null,
      tickets: [],
      capacity: { maxCreateFlowBps: 0, windowCapShares: null, pendingCreateCash: "0", pendingRedeemShares: "0" },
    });
    expect(q.queueAddress).toBeNull();
    expect(q.tickets).toHaveLength(0);
  });

  it("forwardHistory parses event kinds with a string-keyed payload", () => {
    const h = forwardHistorySchema.parse({
      items: [
        { kind: "PartialFill", id: 3, txHash: "0xh", timestampMs: 5,
          payload: { filledCash: "1000000", remainingCash: "2000000" } },
        { kind: "Settled", id: 3, txHash: "0xh2", timestampMs: 6, payload: {} },
      ],
    });
    expect(h.items[0]!.kind).toBe("PartialFill");
    expect(h.items[0]!.payload.filledCash).toBe("1000000");
  });

  it("forwardHistory rejects an unknown event kind", () => {
    expect(() =>
      forwardHistorySchema.parse({
        items: [{ kind: "Liquidated", id: 0, txHash: "0xh", timestampMs: 0, payload: {} }],
      }),
    ).toThrow();
  });
});

describe("positions / availability / quotes DTOs", () => {
  it("accountHoldings lists valued positions", () => {
    const a = accountHoldingsResponseSchema.parse({
      account: "0xo",
      holdings: [{ vaultAddress: "0xv", symbol: "mTECH", balance: "1000000000000000000", valueUsd: "50000000000000000000", estimated: false }],
    });
    expect(a.holdings[0]!.symbol).toBe("mTECH");
  });

  it("availability is protocol/market only with a typed reason", () => {
    const av = availabilityResponseSchema.parse({
      vaultAddress: "0xv", account: null,
      items: [{ action: "mint", enabled: false, reason: "frozen" }],
    });
    expect(av.items[0]!.reason).toBe("frozen");
    expect(txActionSchema.parse("auctionOpen")).toBe("auctionOpen");
    expect(() => txActionSchema.parse("nope")).toThrow();
  });

  it("availability accepts the unsupported-vault-type reason (non-rebalance gate)", () => {
    const av = availabilityResponseSchema.parse({
      vaultAddress: "0xv", account: null,
      items: [{ action: "forwardCreate", enabled: false, reason: "unsupported-vault-type" }],
    });
    expect(av.items[0]!.reason).toBe("unsupported-vault-type");
  });

  it("mintQuote carries deposits + gate (fee omitted by default)", () => {
    const q = mintQuoteResponseSchema.parse({
      unitsOut: "3000000000000000000",
      deposits: [{ token: "0xA", symbol: "TSLA", amount: "100000000000000000", valueUsd: "25000000000000000000" }],
      estTotalUsd: "75000000000000000000",
      gate: { gated: false, reason: "none" },
    });
    expect(q.deposits[0]!.symbol).toBe("TSLA");
    expect(q.fee).toBeUndefined();
  });

  it("mintQuote carries an optional USDG flatCreateFee", () => {
    const q = mintQuoteResponseSchema.parse({
      unitsOut: "3000000000000000000",
      deposits: [{ token: "0xA", symbol: "TSLA", amount: "100000000000000000", valueUsd: "25000000000000000000" }],
      estTotalUsd: "75000000000000000000",
      gate: { gated: false, reason: "none" },
      fee: { token: "0xFEED", symbol: "USDG", amount: "5000000", valueUsd: "5000000000000000000" },
    });
    expect(q.fee!.symbol).toBe("USDG");
    expect(q.fee!.amount).toBe("5000000");
  });

  it("redeem-quote assets stay back-compat ({token,amount}) and accept enrichment", () => {
    const old = redeemQuoteResponseSchema.parse({ assets: [{ token: "0xt", amount: "5" }], gateState: { gated: false, reason: "none" } });
    expect(old.assets[0]!.token).toBe("0xt");
    const rich = redeemQuoteResponseSchema.parse({ assets: [{ token: "0xt", amount: "5", symbol: "TSLA", valueUsd: "1" }], gateState: { gated: false, reason: "none" } });
    expect(rich.assets[0]!.symbol).toBe("TSLA");
  });
});

describe("holdings DTOs", () => {
  it("enriched constituent keeps {token,unitQty} valid and accepts optional symbol/decimals", () => {
    expect(constituentDtoSchema.parse({ token: "0xA", unitQty: "10" })).toEqual({ token: "0xA", unitQty: "10" });
    const e = constituentDtoSchema.parse({ token: "0xA", unitQty: "10", symbol: "TSLA", decimals: 18 });
    expect(e.symbol).toBe("TSLA");
    expect(e.decimals).toBe(18);
  });

  it("holdingRow carries real price/value/weight/drift", () => {
    const r = holdingRowSchema.parse({
      token: "0xA", symbol: "TSLA", name: null, decimals: 18,
      qtyPerUnit: "100000000000000000", priceUsd: "250000000000000000000",
      valuePerUnitUsd: "25000000000000000000", currentWeightBps: 5000,
      targetWeightBps: 5000, driftBps: 0, estimated: false,
    });
    expect(r.currentWeightBps).toBe(5000);
    expect(r.symbol).toBe("TSLA");
  });

  it("holdingsResponse bundles navPerUnit + rows", () => {
    const h = holdingsResponseSchema.parse({
      vaultAddress: "0xv", navPerUnit: "50000000000000000000", estimated: true, timestampMs: 1,
      holdings: [],
    });
    expect(h.estimated).toBe(true);
    expect(h.holdings).toHaveLength(0);
  });
});

describe("TxPlan DTOs", () => {
  it("parses a send step (approve/call)", () => {
    const s = txStepSchema.parse({
      kind: "approve", to: "0xabc", data: "0xdead", value: "0",
      contractName: "TSLA", label: "Approve TSLA", summary: "Approve vault to pull 0.1 TSLA", simulated: true,
    });
    expect(s.kind).toBe("approve");
  });

  it("parses a sign712 permit step", () => {
    const s = txStepSchema.parse({
      kind: "sign712", token: "0xA", label: "Sign TSLA permit", summary: "Gasless approval",
      typedData: {
        domain: { name: "TSLA", version: "1", chainId: 46630, verifyingContract: "0x000000000000000000000000000000000000000A" },
        types: { Permit: [{ name: "owner", type: "address" }] },
        primaryType: "Permit",
        message: { owner: "0x0000000000000000000000000000000000000001", spender: "0x0000000000000000000000000000000000000002", value: "1", nonce: "0", deadline: "99" },
      },
    });
    expect(s.kind).toBe("sign712");
  });

  it("plan gated => empty steps; finalize nullable", () => {
    const p = txPlanSchema.parse({ chainId: 46630, gate: { gated: true, reason: "frozen" }, steps: [], finalize: null });
    expect(p.steps).toHaveLength(0);
    const p2 = txPlanSchema.parse({ chainId: 46630, gate: { gated: false, reason: "none" }, steps: [], finalize: { path: "/x" } });
    expect(p2.finalize!.path).toBe("/x");
  });
});

describe("auction tx-request DTOs", () => {
  it("auctionOpen carries release legs (token+releaseOut) and acquire legs (token+startIn/endIn)", () => {
    const open = auctionOpenTxRequestSchema.parse({
      account: "0xacc",
      durationSec: 3600,
      release: [{ token: "0xrel", releaseOut: "1000000000000000000" }],
      acquire: [{ token: "0xacq", startIn: "2000000000000000000", endIn: "1000000000000000000" }],
    });
    expect(open.durationSec).toBe(3600);
    expect(open.release[0]!.releaseOut).toBe("1000000000000000000");
    expect(open.acquire[0]!.startIn).toBe("2000000000000000000");
    expect(open.acquire[0]!.endIn).toBe("1000000000000000000");
  });

  it("auctionOpen accepts empty leg arrays and rejects non-integer amounts / non-positive duration", () => {
    expect(auctionOpenTxRequestSchema.parse({ account: "0xacc", durationSec: 1, release: [], acquire: [] }).release).toHaveLength(0);
    expect(() =>
      auctionOpenTxRequestSchema.parse({
        account: "0xacc", durationSec: 1, release: [{ token: "0xr", releaseOut: "1.5" }], acquire: [],
      }),
    ).toThrow();
    expect(() =>
      auctionOpenTxRequestSchema.parse({ account: "0xacc", durationSec: 0, release: [], acquire: [] }),
    ).toThrow();
  });

  it("auctionBid carries the acquire tokens+amounts to approve before bid(vault)", () => {
    const bid = auctionBidTxRequestSchema.parse({
      account: "0xacc",
      acquire: [{ token: "0xacq", amount: "5000000000000000000" }],
    });
    expect(bid.acquire[0]!.token).toBe("0xacq");
    expect(bid.acquire[0]!.amount).toBe("5000000000000000000");
  });

  it("auctionBid rejects a non-integer (decimal) amount", () => {
    expect(() =>
      auctionBidTxRequestSchema.parse({ account: "0xacc", acquire: [{ token: "0xacq", amount: "5.0" }] }),
    ).toThrow();
  });
});

describe("auctionStatus DTO", () => {
  it("parses a deployed auction status with execMode, openAllow, acquireIn", () => {
    const status = auctionStatusSchema.parse({
      vaultAddress: "0xvault",
      deployed: true,
      execMode: 2,
      openAllow: true,
      acquireIn: ["1000000000000000000", "500000000000000000"],
    });
    expect(status.deployed).toBe(true);
    expect(status.execMode).toBe(2);
    expect(status.openAllow).toBe(true);
    expect(status.acquireIn).toHaveLength(2);
    expect(status.acquireIn[0]).toBe("1000000000000000000");
  });

  it("parses the not-deployed defaults (zeros/empty)", () => {
    const status = auctionStatusSchema.parse({
      vaultAddress: "0xvault",
      deployed: false,
      execMode: 0,
      openAllow: false,
      acquireIn: [],
    });
    expect(status.deployed).toBe(false);
    expect(status.execMode).toBe(0);
    expect(status.acquireIn).toHaveLength(0);
  });

  it("rejects a non-integer execMode", () => {
    expect(() =>
      auctionStatusSchema.parse({
        vaultAddress: "0xv", deployed: true, execMode: 1.5, openAllow: false, acquireIn: [],
      }),
    ).toThrow();
  });
});

describe("previewDeploy schemas", () => {
  it("accepts a quantities request", () => {
    const r = previewDeployRequestSchema.parse({
      account: "0xacc", vaultKind: "basket", name: "X", symbol: "X",
      tokens: ["0xA"], unitSize: "1000",
      composition: { mode: "quantities", qty: ["50"] },
    });
    expect(r.composition.mode).toBe("quantities");
  });
  it("accepts a weights request", () => {
    const r = previewDeployRequestSchema.parse({
      account: "0xacc", vaultKind: "rebalance", name: "X", symbol: "X",
      tokens: ["0xA", "0xB"], unitSize: "1000",
      composition: { mode: "weights", weightsBps: [4000, 6000], valuePerUnitUsd: "1000" },
    });
    if (r.composition.mode !== "weights") throw new Error("mode");
    expect(r.composition.weightsBps).toEqual([4000, 6000]);
  });
  it("parses a response with predictedVault + gate", () => {
    const p = previewDeployResponseSchema.parse({
      unitQty: ["3030000000000000000"],
      breakdown: [{ token: "0xA", symbol: "PLTR", qty: "3.03", valueUsd: "400000000000000000000", weightBps: 4000 }],
      totalValueUsd: "1000000000000000000000",
      priceMissing: [],
      predictedVault: "0xVault",
      gate: { gated: false, reason: "none" },
    });
    expect(p.predictedVault).toBe("0xVault");
  });
  it("allows predictedVault null when gated", () => {
    const p = previewDeployResponseSchema.parse({
      unitQty: [], breakdown: [], totalValueUsd: "0", priceMissing: ["0xA"],
      predictedVault: null, gate: { gated: true, reason: "price-missing" },
    });
    expect(p.predictedVault).toBeNull();
  });
});

describe("suggestedFunds catalog DTO", () => {
  it("parses a fund with sample holdings, holdingsCount, and no resolvable tokens (reference-only)", () => {
    const r = suggestedFundsResponseSchema.parse({
      funds: [
        {
          id: "sp500",
          name: "S&P 500",
          category: "broad market",
          recommendedVaultKind: "registry",
          description: "The 500 large-cap US companies (SPY).",
          sampleHoldings: [
            { symbol: "NVDA", weightBps: 842, address: "0xD798Fb9fCc5208fB935E974cd3f673B95C9EE69E" },
            { symbol: "AAPL", weightBps: 710, address: "0x012c768e5162d5Ed965D45935634EFCe705A57AC" },
          ],
          holdingsCount: 442,
          coveragePct: 94.85,
          resolvableTokens: [],
        },
      ],
    });
    expect(r.funds[0]!.recommendedVaultKind).toBe("registry");
    expect(r.funds[0]!.holdingsCount).toBe(442);
    expect(r.funds[0]!.sampleHoldings).toHaveLength(2);
    expect(r.funds[0]!.resolvableTokens).toHaveLength(0);
  });

  it("carries resolvable tokens for pre-fill and accepts a null sample address", () => {
    const r = suggestedFundsResponseSchema.parse({
      funds: [
        {
          id: "dow30",
          name: "Dow Jones 30",
          category: "broad market",
          recommendedVaultKind: "basket",
          description: "DIA.",
          sampleHoldings: [{ symbol: "UNRESOLVED", weightBps: 100, address: null }],
          holdingsCount: 29,
          resolvableTokens: [
            { token: "0xabc", symbol: "AAPL", weightBps: 5000 },
            { token: "0xdef", symbol: "MSFT", weightBps: 5000 },
          ],
        },
      ],
    });
    expect(r.funds[0]!.sampleHoldings[0]!.address).toBeNull();
    expect(r.funds[0]!.resolvableTokens).toHaveLength(2);
    expect(r.funds[0]!.coveragePct).toBeUndefined();
  });

  it("rejects an unknown recommendedVaultKind", () => {
    expect(() =>
      suggestedFundsResponseSchema.parse({
        funds: [{ id: "x", name: "X", category: "c", recommendedVaultKind: "nope", description: "d", sampleHoldings: [], holdingsCount: 0, resolvableTokens: [] }],
      }),
    ).toThrow();
  });
});

describe("registry AP/holder claim-lifecycle tx request schemas", () => {
  const ACCT = "0x0000000000000000000000000000000000000001";
  const TOK = "0x000000000000000000000000000000000000aaaa";

  it("parses wrap / unwrap with base-unit amounts", () => {
    expect(registryWrapTxRequestSchema.parse({ token: TOK, amount: "2000000000000000000", account: ACCT }).amount).toBe(
      "2000000000000000000",
    );
    const uw = registryUnwrapTxRequestSchema.parse({ token: TOK, amount: "5", to: ACCT, account: ACCT });
    expect(uw.to).toBe(ACCT);
  });

  it("rejects a decimal-point (non-integer base-unit) wrap amount", () => {
    expect(() => registryWrapTxRequestSchema.parse({ token: TOK, amount: "2.5", account: ACCT })).toThrow();
  });

  it("batchWrap requires tokens and amounts to be the same length", () => {
    expect(
      registryBatchWrapTxRequestSchema.parse({ tokens: [TOK], amounts: ["1"], account: ACCT }).tokens,
    ).toHaveLength(1);
    expect(() =>
      registryBatchWrapTxRequestSchema.parse({ tokens: [TOK], amounts: ["1", "2"], account: ACCT }),
    ).toThrow();
  });

  it("setOperator carries a boolean approved flag", () => {
    expect(registrySetOperatorTxRequestSchema.parse({ operator: TOK, approved: true, account: ACCT }).approved).toBe(true);
    expect(() => registrySetOperatorTxRequestSchema.parse({ operator: TOK, approved: "yes", account: ACCT })).toThrow();
  });

  it("bootstrap requires tokens/unitQty aligned; nShares optional", () => {
    const ok = registryBootstrapTxRequestSchema.parse({
      tokens: [TOK],
      unitQty: ["2000000000000000000"],
      unitSize: "1000000000000000000",
      account: ACCT,
    });
    expect(ok.nShares).toBeUndefined();
    expect(() =>
      registryBootstrapTxRequestSchema.parse({ tokens: [TOK], unitQty: [], unitSize: "1", account: ACCT }),
    ).toThrow();
  });

  it("registry in-kind create/redeem parse (redeem withUnwrap optional)", () => {
    expect(registryCreateTxRequestSchema.parse({ nShares: "1000000000000000000", account: ACCT }).nShares).toBe(
      "1000000000000000000",
    );
    const r = registryRedeemTxRequestSchema.parse({ amount: "1000000000000000000", account: ACCT });
    expect(r.withUnwrap).toBeUndefined();
    expect(registryRedeemTxRequestSchema.parse({ amount: "1", withUnwrap: false, account: ACCT }).withUnwrap).toBe(false);
  });
});
