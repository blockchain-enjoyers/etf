import type {
  MeridianApi,
  FeedResponse,
  BasketSummary,
  BasketDetail,
  NavResponse,
  MarketPrice,
  PremiumDiscount,
  HistoryPoint,
  HistoryQuery,
  RedeemQuoteRequest,
  RedeemQuoteResponse,
  RebalanceDetail,
  KeeperStatus,
  RebalanceHistory,
  ForwardTicket,
  ForwardQueue,
  SettleGateStatus,
  ForwardHistory,
  ActivityEvent,
  AuctionStatus,
  PreviewDeployRequest,
  DeployPreview,
  SuggestedFundsResponse,
  EnableRequest,
  ForwardEnableStatus,
  ConstituentPrice,
  SceneTamper,
  SceneRead,
  TxPlan,
  VaultType,
  TokenInfo,
} from "@meridian/sdk";
import { demoTokens } from "@meridian/contracts";

import {
  fixtureFeed,
  fixtureSummaries,
  fixtureDetails,
  fixtureNavs,
  fixtureMarketPrices,
  fixturePremiumDiscounts,
  fixtureHistory,
  fixtureRedeemQuotes,
} from "./data";

const DELAY_MS = 80;

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// A runnable mock plan = one `call` step. The fixtures-mode useTxPlan short-circuit walks
// steps to success without touching a chain, so a structurally-valid TxPlan is enough.
function mockPlan(label: string): TxPlan {
  return {
    chainId: 46630,
    gate: { gated: false, reason: "none" },
    steps: [
      {
        kind: "call",
        to: "0x0000000000000000000000000000000000000001",
        data: "0x",
        value: "0",
        contractName: "Mock",
        label,
        summary: label,
        simulated: true,
      },
    ],
    finalize: null,
  };
}

// Address -> demo token (symbol/name/price). Drives fixtures pricing + symbol resolution.
const TOK = new Map(demoTokens.map((t) => [t.address.toLowerCase(), t]));
const E18 = 10n ** 18n;
// priceUsd (number) -> 18-dec USD bigint (6-dec price precision is plenty for the demo).
function price18(token: string): bigint {
  const p = TOK.get(token.toLowerCase())?.priceUsd ?? 0;
  return BigInt(Math.round(p * 1e6)) * 10n ** 12n;
}
function symOf(token: string): string {
  return TOK.get(token.toLowerCase())?.symbol ?? token.slice(2, 6).toUpperCase();
}
function toBase18(v: string): string {
  const [whole, frac = ""] = String(v).split(".");
  return BigInt(`${whole || "0"}${frac.padEnd(18, "0").slice(0, 18)}`).toString();
}
// Gentle 24/7 wall-clock drift so fixture prices "live": a per-key sine wobble (~±0.6%).
// Deterministic from the clock, so consecutive polls move smoothly.
function driftFactor(key: string): bigint {
  const t = Date.now() / 1000;
  const phase = Array.from(key).reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const pct = Math.sin(t / 30 + phase) * 0.4 + Math.sin(t / 6.5 + phase) * 0.18; // ~±0.58%
  return BigInt(Math.round((1 + pct / 100) * 1e6)) * 10n ** 12n; // 1e18-scaled
}
function scale(x: bigint, factor: bigint): bigint {
  return (x * factor) / 10n ** 18n;
}
function applyDrift(base: bigint, key: string): bigint {
  return scale(base, driftFactor(key));
}
// Deterministic, realistic-looking hex from a seed (xmur3 + a small xorshift expansion).
// Same seed → same output, so a vault's predicted address is stable across calls.
function pseudoHex(seed: string, nChars: number): string {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let x = h >>> 0;
  let out = "";
  while (out.length < nChars) {
    x = Math.imul(x ^ (x >>> 16), 2246822507);
    x = Math.imul(x ^ (x >>> 13), 3266489909);
    x ^= x >>> 16;
    out += (x >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, nChars);
}

export class FixtureApi implements MeridianApi {
  // Created vaults synthesized from buildDeployTx, so create → list → detail works in fixtures mode.
  private created = new Map<string, BasketDetail>();
  // In-memory positions ("account:vault" -> 18-dec share balance) so enter (mint/forward/registry
  // create) gives a position that the Portfolio + redeem (exit) can see. Fixtures-only.
  private positions = new Map<string, bigint>();
  private posKey(account: string, vault: string): string {
    return `${account.toLowerCase()}:${vault.toLowerCase()}`;
  }
  private credit(account: string, vault: string, delta: bigint): void {
    const k = this.posKey(account, vault);
    const next = (this.positions.get(k) ?? 0n) + delta;
    this.positions.set(k, next > 0n ? next : 0n);
  }

  private vaultAddrFor(symbol: string): string {
    // Realistic-looking but deterministic per symbol (preview + deploy + result page must agree).
    return "0x" + pseudoHex("meridian-vault:" + symbol, 40);
  }

  private createdConstituents(v: string) {
    return this.created.get(v.toLowerCase())?.constituents ?? [];
  }
  async getFeed(): Promise<FeedResponse> {
    await delay(DELAY_MS);
    return fixtureFeed;
  }

  async listBaskets(): Promise<BasketSummary[]> {
    await delay(DELAY_MS);
    const synthesized: BasketSummary[] = Array.from(this.created.values()).map((d) => ({
      vaultAddress: d.vaultAddress,
      name: d.name,
      symbol: d.symbol,
      frozen: d.frozen,
      weightMethod: d.weightMethod,
      vaultType: d.vaultType,
      manager: d.manager ?? null,
      managerFeeBps: d.managerFeeBps ?? null,
      keeperBps: d.keeperBps ?? null,
    }));
    return [...fixtureSummaries, ...synthesized];
  }

  async getBasket(vaultAddress: string): Promise<BasketDetail> {
    await delay(DELAY_MS);
    const detail = this.created.get(vaultAddress.toLowerCase()) ?? fixtureDetails[vaultAddress];
    if (!detail) throw new Error(`Fixture: no basket for ${vaultAddress}`);
    return detail;
  }

  async getNav(vaultAddress: string): Promise<NavResponse> {
    await delay(DELAY_MS);
    if (this.created.has(vaultAddress.toLowerCase())) {
      const nav = applyDrift(1000n * E18, vaultAddress);
      const band = nav / 500n; // ~0.2%
      return {
        vaultAddress,
        nav: nav.toString(),
        confidenceLower: (nav - band).toString(),
        confidenceUpper: (nav + band).toString(),
        marketStatus: "regular",
        estimated: false,
        source: "chainlink",
        timestampMs: Date.now(),
      };
    }
    const base = fixtureNavs[vaultAddress];
    if (!base) throw new Error(`Fixture: no nav for ${vaultAddress}`);
    // Drift nav + both bounds by the SAME factor so the band width (wide for closed/estimated) is preserved.
    const f = driftFactor(vaultAddress);
    return {
      ...base,
      nav: scale(BigInt(base.nav), f).toString(),
      confidenceLower: scale(BigInt(base.confidenceLower), f).toString(),
      confidenceUpper: scale(BigInt(base.confidenceUpper), f).toString(),
      timestampMs: Date.now(),
    };
  }

  async getMarketPrice(vaultAddress: string): Promise<MarketPrice> {
    await delay(DELAY_MS);
    if (this.created.has(vaultAddress.toLowerCase())) {
      return { vaultAddress, marketPrice: "1001000000000000000000", timestampMs: Date.now() - 3_000 };
    }
    const price = fixtureMarketPrices[vaultAddress];
    if (!price) throw new Error(`Fixture: no market price for ${vaultAddress}`);
    return price;
  }

  async getPremiumDiscount(vaultAddress: string): Promise<PremiumDiscount> {
    await delay(DELAY_MS);
    if (this.created.has(vaultAddress.toLowerCase())) {
      return { premiumBps: 10, nav: "1000000000000000000000", marketPrice: "1001000000000000000000" };
    }
    const pd = fixturePremiumDiscounts[vaultAddress];
    if (!pd) throw new Error(`Fixture: no premium/discount for ${vaultAddress}`);
    return pd;
  }

  async getHistory(
    vaultAddress: string,
    _range: HistoryQuery["range"]
  ): Promise<HistoryPoint[]> {
    await delay(DELAY_MS);
    if (this.created.has(vaultAddress.toLowerCase())) {
      const base = 1000;
      const now = Date.now();
      return Array.from({ length: 24 }, (_, i) => ({
        timestampMs: now - (23 - i) * 3_600_000,
        nav: String(BigInt(Math.round((base + Math.sin(i) * 4) * 1e18))),
        estimated: false,
      }));
    }
    const history = fixtureHistory[vaultAddress];
    if (!history) throw new Error(`Fixture: no history for ${vaultAddress}`);
    return history;
  }

  async getRedeemQuote(
    vaultAddress: string,
    _req: RedeemQuoteRequest
  ): Promise<RedeemQuoteResponse> {
    await delay(DELAY_MS);
    const quote = fixtureRedeemQuotes[vaultAddress];
    if (!quote) throw new Error(`Fixture: no redeem quote for ${vaultAddress}`);
    return quote;
  }

  async getRebalanceDetail(vaultAddress: string): Promise<RebalanceDetail> {
    await delay(DELAY_MS);
    const heldTokens = this.createdConstituents(vaultAddress).map((c) => ({
      token: c.token,
      balance: c.unitQty,
    }));
    return { vaultAddress, heldTokens, target: [], pendingTarget: null, lastRebalanceAtMs: null, drift: null };
  }

  async getKeeperStatus(_vaultAddress: string): Promise<KeeperStatus> {
    await delay(DELAY_MS);
    return { escrow: "0", keeperBps: 0, payouts: [] };
  }

  async getRebalanceHistory(_vaultAddress: string): Promise<RebalanceHistory> {
    await delay(DELAY_MS);
    return { items: [] };
  }

  async getForwardTickets(_vaultAddress: string, _owner?: string): Promise<ForwardTicket[]> {
    await delay(DELAY_MS);
    return [];
  }

  async getForwardQueue(_vaultAddress: string): Promise<ForwardQueue> {
    await delay(DELAY_MS);
    return {
      queueAddress: "0xqueue0000000000000000000000000000000001",
      tickets: [],
      capacity: {
        maxCreateFlowBps: 2000,
        windowCapShares: null,
        pendingCreateCash: "0",
        pendingRedeemShares: "0",
      },
      fees: {
        isRegistry: true,
        feeToken: "0xusdg00000000000000000000000000000000usdg",
        flatCreateFee: "1000000",
        flatRedeemFee: "1000000",
      },
    };
  }

  async getSettleGateStatus(_vaultAddress: string): Promise<SettleGateStatus> {
    await delay(DELAY_MS);
    // estimated is z.literal(true) by schema (IRON RULE: informational only). open:true => all guards ok.
    return {
      open: true,
      navPerShare: "1000000000000000000000",
      twap: "1000000000000000000000",
      guards: [
        { id: "g2", ok: true, reason: null },
        { id: "g6", ok: true, reason: null },
      ],
      estimated: true,
    };
  }

  async getForwardHistory(_vaultAddress: string): Promise<ForwardHistory> {
    await delay(DELAY_MS);
    return { items: [] };
  }

  async getHoldings(vaultAddress: string) {
    await delay(DELAY_MS);
    // Constituents come from a created vault (in-memory) or an existing fixture vault.
    const cons =
      this.created.get(vaultAddress.toLowerCase())?.constituents ??
      fixtureDetails[vaultAddress]?.constituents ??
      [];
    if (cons.length === 0) {
      return { vaultAddress, navPerUnit: "0", estimated: false, timestampMs: Date.now(), holdings: [] };
    }
    const rows = cons.map((c) => {
      const p = price18(c.token);
      return { c, p, value: (BigInt(c.unitQty) * p) / E18 }; // value = 18-dec USD per unit for this leg
    });
    const navPerUnit = rows.reduce((a, r) => a + r.value, 0n);
    const holdings = rows.map(({ c, p, value }) => {
      const wBps = navPerUnit > 0n ? Number((value * 10000n) / navPerUnit) : 0;
      return {
        token: c.token,
        symbol: ("symbol" in c && c.symbol) || symOf(c.token),
        name: ("name" in c && c.name) || null,
        decimals: 18,
        qtyPerUnit: c.unitQty,
        priceUsd: p.toString(),
        valuePerUnitUsd: value.toString(),
        currentWeightBps: wBps,
        targetWeightBps: wBps,
        driftBps: 0,
        estimated: false,
      };
    });
    return {
      vaultAddress,
      navPerUnit: (navPerUnit > 0n ? navPerUnit : 1000000000000000000000n).toString(),
      estimated: false,
      timestampMs: Date.now(),
      holdings,
    };
  }

  async getAccountHoldings(account: string) {
    await delay(DELAY_MS);
    // Demo positions so fixture-mode Portfolio renders content. valueUsd = balance * nav / 1e18.
    const seeded = [
      {
        vaultAddress: "0xaaaa000000000000000000000000000000000001",
        symbol: "RH5",
        balance: "3000000000000000000",
        valueUsd: "3613500000000000000000",
        estimated: false,
      },
      {
        vaultAddress: "0xaaaa000000000000000000000000000000000002",
        symbol: "AI3",
        balance: "2000000000000000000",
        valueUsd: "1760400000000000000000",
        estimated: false,
      },
    ];
    // Live positions the user entered this session (mint / forward / registry create).
    const NAV = 1000n; // created vaults price ~$1000/unit
    const owned = [...this.positions.entries()]
      .filter(([k, bal]) => k.startsWith(account.toLowerCase() + ":") && bal > 0n)
      .map(([k, bal]) => {
        const vault = k.split(":")[1]!;
        return {
          vaultAddress: vault,
          symbol: this.created.get(vault)?.symbol ?? vault.slice(2, 6).toUpperCase(),
          balance: bal.toString(),
          valueUsd: (bal * NAV).toString(),
          estimated: false,
        };
      });
    return { account, holdings: [...owned, ...seeded] };
  }

  async getAccountForwardTickets(_account: string): Promise<ForwardTicket[]> {
    await delay(DELAY_MS);
    return [];
  }

  async getAccountActivity(_account: string): Promise<ActivityEvent[]> {
    await delay(DELAY_MS);
    return [
      {
        vaultAddress: "0xaaaa000000000000000000000000000000000001",
        symbol: "RH5",
        owner: "0xdemo",
        kind: "mint",
        payload: { nUnits: "1000000000000000000", minted: "3000000000000000000" },
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        timestampMs: 1781100000000,
      },
    ];
  }

  async getAvailability(vaultAddress: string, account?: string) {
    await delay(DELAY_MS);
    return { vaultAddress, account: account ?? null, items: [] };
  }

  async getMintQuote(vaultAddress: string, req: { units: string; account?: string; mode?: "permit" | "approve" }) {
    await delay(DELAY_MS);
    let cons = this.createdConstituents(vaultAddress);
    if (cons.length === 0) cons = fixtureDetails[vaultAddress]?.constituents ?? [];
    let units: bigint;
    try {
      units = BigInt(req.units || "0");
    } catch {
      units = 0n;
    }
    const ONE = 1_000_000_000_000_000_000n; // 1e18
    let totalUsd = 0n;
    const deposits = cons.map((c) => {
      const qty = BigInt(c.unitQty || "0");
      const amount = (qty * units) / ONE;
      const priceUsd = price18(c.token);
      const valueUsd = (amount * priceUsd) / ONE;
      totalUsd += valueUsd;
      return {
        token: c.token,
        symbol: symOf(c.token),
        amount: amount.toString(),
        valueUsd: valueUsd.toString(),
      };
    });
    return {
      unitsOut: units.toString(),
      deposits,
      estTotalUsd: totalUsd.toString(),
      gate: { gated: false, reason: "none" as const },
    };
  }

  async buildMintTx(vaultAddress: string, req: { units: string; account: string; mode?: "permit" | "approve" }) {
    await delay(DELAY_MS);
    this.credit(req.account, vaultAddress, BigInt(toBase18(req.units || "0")));
    return mockPlan("Mint units");
  }

  async finalizeMintTx(_vaultAddress: string, _req: { units: string; account: string; permits: unknown[] }) {
    await delay(DELAY_MS);
    return mockPlan("Finalize mint");
  }

  async buildRedeemTx(vaultAddress: string, req: { amount: string; account: string }) {
    await delay(DELAY_MS);
    this.credit(req.account, vaultAddress, -BigInt(toBase18(req.amount || "0")));
    return mockPlan("Redeem in-kind");
  }

  async buildDeployTx(req: Record<string, unknown>): Promise<TxPlan> {
    await delay(DELAY_MS);
    const symbol = String(req.symbol ?? "NEW");
    const name = String(req.name ?? symbol);
    const vaultType = (req.vaultKind as VaultType | undefined) ?? "basket";
    const vaultAddress = this.vaultAddrFor(symbol);

    // Deploy req carries resolved tokens + unitQty (base units). Tolerate a `composition` shape too.
    const tokens = Array.isArray(req.tokens) ? (req.tokens as unknown[]).map(String) : [];
    const rawQty = Array.isArray(req.unitQty) ? (req.unitQty as unknown[]).map(String) : [];
    const composition = req.composition as
      | { mode?: string; qty?: unknown[]; weightsBps?: unknown[] }
      | undefined;

    let constituents: { token: string; unitQty: string }[];
    if (rawQty.length === tokens.length && tokens.length > 0) {
      constituents = tokens.map((token, i) => ({ token, unitQty: rawQty[i] ?? "0" }));
    } else if (composition?.mode === "weights" && Array.isArray(composition.weightsBps)) {
      const weights = composition.weightsBps.map((w) => String(w));
      constituents = tokens.map((token, i) => ({ token, unitQty: weights[i] ?? "0" }));
    } else if (tokens.length > 0) {
      const equal = String(Math.floor(10_000 / tokens.length));
      constituents = tokens.map((token) => ({ token, unitQty: equal }));
    } else {
      constituents = [];
    }

    // Persist the picked stocks with their resolved ticker/name so the created vault shows them.
    const enriched = constituents.map((c) => ({
      token: c.token,
      unitQty: c.unitQty,
      symbol: symOf(c.token),
      name: TOK.get(c.token.toLowerCase())?.name,
    }));

    const detail: BasketDetail = {
      vaultAddress,
      name,
      symbol,
      frozen: false,
      vaultType,
      manager: typeof req.manager === "string" ? req.manager : null,
      managerFeeBps: typeof req.managerFeeBps === "number" ? req.managerFeeBps : null,
      keeperBps: typeof req.keeperBps === "number" ? req.keeperBps : null,
      basketToken: null,
      cashToken: null,
      unitSize: typeof req.unitSize === "string" ? req.unitSize : "1000000000000000000",
      constituents: enriched,
    };
    this.created.set(vaultAddress, detail);
    return mockPlan("Deploy " + symbol);
  }

  async buildWrapTx(_vaultAddress: string, _req: { token: string; amount: string; account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Wrap token");
  }

  async buildBatchWrapTx(_vaultAddress: string, _req: { tokens: string[]; amounts: string[]; account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Batch wrap");
  }

  async buildUnwrapTx(_vaultAddress: string, _req: { token: string; amount: string; to: string; account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Unwrap token");
  }

  async buildSetOperatorTx(_vaultAddress: string, _req: { operator: string; approved: boolean; account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Set operator");
  }

  async buildBootstrapTx(
    _vaultAddress: string,
    _req: { tokens: string[]; unitQty: string[]; unitSize: string; nShares?: string; account: string },
  ) {
    await delay(DELAY_MS);
    return mockPlan("Bootstrap vault");
  }

  async buildRegistryCreateTx(vaultAddress: string, req: { nShares: string; account: string }) {
    await delay(DELAY_MS);
    this.credit(req.account, vaultAddress, BigInt(toBase18(req.nShares || "0")));
    return mockPlan("Registry create");
  }

  async buildRegistryRedeemTx(vaultAddress: string, req: { amount: string; withUnwrap?: boolean; account: string }) {
    await delay(DELAY_MS);
    this.credit(req.account, vaultAddress, -BigInt(toBase18(req.amount || "0")));
    return mockPlan("Registry redeem");
  }

  async previewDeploy(req: PreviewDeployRequest): Promise<DeployPreview> {
    await delay(DELAY_MS);
    const comp = req.composition;
    const unitQty: bigint[] = [];
    const valueUsd: bigint[] = [];

    req.tokens.forEach((token, i) => {
      const p = price18(token);
      if (comp.mode === "quantities") {
        const q = BigInt(toBase18(comp.qty[i] ?? "0"));
        unitQty.push(q);
        valueUsd.push((q * p) / E18);
      } else {
        // weights: legValue = valuePerUnit * weightBps / 1e4; qty = legValue / price
        const notional = BigInt(toBase18(comp.valuePerUnitUsd)); // 18-dec USD
        const legVal = (notional * BigInt(comp.weightsBps[i] ?? 0)) / 10000n;
        const q = p > 0n ? (legVal * E18) / p : 0n;
        unitQty.push(q);
        valueUsd.push((q * p) / E18);
      }
    });

    const total = valueUsd.reduce((a, b) => a + b, 0n);
    const priceMissing = req.tokens.filter((t) => price18(t) === 0n);
    const breakdown = req.tokens.map((token, i) => ({
      token,
      symbol: symOf(token),
      qty: (Number(unitQty[i] ?? 0n) / 1e18).toString(),
      valueUsd: (valueUsd[i] ?? 0n).toString(),
      weightBps: total > 0n ? Number(((valueUsd[i] ?? 0n) * 10000n) / total) : 0,
    }));

    // Weights mode needs a price for every leg; a non-catalog (pasted) token has none.
    const gated = comp.mode === "weights" && priceMissing.length > 0;
    return {
      unitQty: unitQty.map(String),
      breakdown,
      totalValueUsd: total.toString(),
      priceMissing,
      predictedVault: this.vaultAddrFor(req.symbol),
      gate: gated ? { gated: true, reason: "price-missing" } : { gated: false, reason: "none" },
    };
  }

  async buildForwardCreateTx(vaultAddress: string, req: { cash: string; account: string }) {
    await delay(DELAY_MS);
    // cash is USDC base (6-dec); at ~$1000/share that's `cash * 1e9` shares (18-dec).
    this.credit(req.account, vaultAddress, BigInt(req.cash || "0") * 1_000_000_000n);
    return mockPlan("Forward create");
  }

  async buildForwardRedeemTx(vaultAddress: string, req: { shares: string; account: string }) {
    await delay(DELAY_MS);
    this.credit(req.account, vaultAddress, -BigInt(toBase18(req.shares || "0")));
    return mockPlan("Forward redeem");
  }

  async buildForwardCancelTx(_vaultAddress: string, _req: { ticketId: number; account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Forward cancel");
  }

  async buildCuratorScheduleTx(_vaultAddress: string, _req: { tokens: string[]; unitQty: string[]; account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Schedule target");
  }

  async buildCuratorActivateTx(_vaultAddress: string, _req: { account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Activate target");
  }

  async buildKeeperRecordTx(_vaultAddress: string, _req: { account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Keeper record");
  }

  async buildKeeperSettleTx(_vaultAddress: string, _req: { ticketIds: number[]; ap: string; account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Keeper settle");
  }

  async buildAuctionOpenTx(
    _vaultAddress: string,
    _req: {
      account: string;
      durationSec: number;
      release: { token: string; releaseOut: string }[];
      acquire: { token: string; startIn: string; endIn: string }[];
    },
  ) {
    await delay(DELAY_MS);
    return mockPlan("Open auction");
  }

  async buildAuctionBidTx(
    _vaultAddress: string,
    _req: { account: string; acquire: { token: string; amount: string }[] },
  ) {
    await delay(DELAY_MS);
    return mockPlan("Auction bid");
  }

  async buildAuctionSetExecModeTx(_vaultAddress: string, _req: { mode: number; account: string }) {
    await delay(DELAY_MS);
    return mockPlan("Set exec mode");
  }

  async getAuctionStatus(vaultAddress: string, _account?: string): Promise<AuctionStatus> {
    await delay(DELAY_MS);
    return { vaultAddress, deployed: false, execMode: 0, openAllow: false, acquireIn: [] };
  }

  async getSuggestedFunds(): Promise<SuggestedFundsResponse> {
    await delay(DELAY_MS);
    return {
      funds: [
        {
          id: "sp500",
          name: "S&P 500",
          category: "broad market",
          recommendedVaultKind: "registry",
          description: "The 500 large-cap US companies in the S&P 500 (SPY).",
          sampleHoldings: [
            { symbol: "NVDA", weightBps: 842, address: "0xnvda" },
            { symbol: "AAPL", weightBps: 710, address: "0xaapl" },
            { symbol: "MSFT", weightBps: 499, address: "0xmsft" },
          ],
          holdingsCount: 442,
          coveragePct: 94.85,
          resolvableTokens: [],
        },
        {
          id: "fintech",
          name: "Fintech & Blockchain",
          category: "thematic",
          recommendedVaultKind: "basket",
          description: "Fintech innovators (ARKF replica).",
          sampleHoldings: [
            { symbol: "AAA", weightBps: 6000, address: "0xaaaa000000000000000000000000000000000001" },
            { symbol: "BBB", weightBps: 4000, address: "0xbbbb000000000000000000000000000000000002" },
          ],
          holdingsCount: 2,
          resolvableTokens: [
            { token: "0xaaaa000000000000000000000000000000000001", symbol: "AAA", weightBps: 6000 },
            { token: "0xbbbb000000000000000000000000000000000002", symbol: "BBB", weightBps: 4000 },
          ],
        },
      ],
    };
  }

  async enableCashSettlement(_vault: string, _body: EnableRequest): Promise<{ status: "pending" }> {
    await delay(DELAY_MS);
    return { status: "pending" };
  }

  async getForwardEnableStatus(_vault: string): Promise<ForwardEnableStatus> {
    await delay(DELAY_MS);
    return { status: "none" };
  }

  async getConstituentPrices(vault: string): Promise<ConstituentPrice[]> {
    await delay(DELAY_MS);
    let cons = this.createdConstituents(vault);
    if (cons.length === 0) cons = fixtureDetails[vault]?.constituents ?? [];
    const tokens = cons.length > 0 ? cons.map((c) => c.token) : [];
    return tokens.map((token) => {
      const p = price18(token);
      const drifted = applyDrift(p > 0n ? p : 100n * E18, token);
      return { token, price: drifted.toString(), sourceCount: 3 };
    });
  }

  async tamperScene(_body: SceneTamper): Promise<{ txHash: string }> {
    await delay(DELAY_MS);
    return { txHash: "0xfixture" };
  }

  async getScene(token: string): Promise<SceneRead> {
    await delay(DELAY_MS);
    return { token, mockPrice: "0" };
  }

  async searchTokens(q: string): Promise<TokenInfo[]> {
    await delay(DELAY_MS);
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return demoTokens
      .filter((t) => t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle))
      .slice(0, 20)
      .map((t) => ({ token: t.address, symbol: t.symbol, name: t.name }));
  }

  async resolveTokens(addresses: string[]): Promise<TokenInfo[]> {
    await delay(DELAY_MS);
    const map = new Map(demoTokens.map((t) => [t.address.toLowerCase(), t]));
    return addresses.map((a) => {
      const hit = map.get(a.toLowerCase());
      return hit
        ? { token: hit.address, symbol: hit.symbol, name: hit.name }
        : { token: a, symbol: a.slice(0, 6), name: null };
    });
  }
}
