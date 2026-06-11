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
  AuctionStatus,
  PreviewDeployRequest,
  DeployPreview,
} from "@meridian/sdk";

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

export class FixtureApi implements MeridianApi {
  async getFeed(): Promise<FeedResponse> {
    await delay(DELAY_MS);
    return fixtureFeed;
  }

  async listBaskets(): Promise<BasketSummary[]> {
    await delay(DELAY_MS);
    return fixtureSummaries;
  }

  async getBasket(vaultAddress: string): Promise<BasketDetail> {
    await delay(DELAY_MS);
    const detail = fixtureDetails[vaultAddress];
    if (!detail) throw new Error(`Fixture: no basket for ${vaultAddress}`);
    return detail;
  }

  async getNav(vaultAddress: string): Promise<NavResponse> {
    await delay(DELAY_MS);
    const nav = fixtureNavs[vaultAddress];
    if (!nav) throw new Error(`Fixture: no nav for ${vaultAddress}`);
    return nav;
  }

  async getMarketPrice(vaultAddress: string): Promise<MarketPrice> {
    await delay(DELAY_MS);
    const price = fixtureMarketPrices[vaultAddress];
    if (!price) throw new Error(`Fixture: no market price for ${vaultAddress}`);
    return price;
  }

  async getPremiumDiscount(vaultAddress: string): Promise<PremiumDiscount> {
    await delay(DELAY_MS);
    const pd = fixturePremiumDiscounts[vaultAddress];
    if (!pd) throw new Error(`Fixture: no premium/discount for ${vaultAddress}`);
    return pd;
  }

  async getHistory(
    vaultAddress: string,
    _range: HistoryQuery["range"]
  ): Promise<HistoryPoint[]> {
    await delay(DELAY_MS);
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
    return { vaultAddress, heldTokens: [], target: [], pendingTarget: null, lastRebalanceAtMs: null, drift: null };
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
      queueAddress: null,
      tickets: [],
      capacity: { maxCreateFlowBps: 0, windowCapShares: null, pendingCreateCash: "0", pendingRedeemShares: "0" },
    };
  }

  async getSettleGateStatus(_vaultAddress: string): Promise<SettleGateStatus> {
    await delay(DELAY_MS);
    return { open: false, navPerShare: null, twap: null, guards: [], estimated: true };
  }

  async getForwardHistory(_vaultAddress: string): Promise<ForwardHistory> {
    await delay(DELAY_MS);
    return { items: [] };
  }

  async getHoldings(vaultAddress: string) {
    await delay(DELAY_MS);
    return { vaultAddress, navPerUnit: "0", estimated: false, timestampMs: Date.now(), holdings: [] };
  }

  async getAccountHoldings(account: string) {
    await delay(DELAY_MS);
    // Demo positions so fixture-mode Portfolio renders content. valueUsd = balance * nav / 1e18.
    return {
      account,
      holdings: [
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
      ],
    };
  }

  async getAvailability(vaultAddress: string, account?: string) {
    await delay(DELAY_MS);
    return { vaultAddress, account: account ?? null, items: [] };
  }

  async getMintQuote(_vaultAddress: string, _req: { units: string; account?: string; mode?: "permit" | "approve" }) {
    await delay(DELAY_MS);
    return { unitsOut: "0", deposits: [], estTotalUsd: "0", gate: { gated: false, reason: "none" as const } };
  }

  buildMintTx(_vaultAddress: string, _req: { units: string; account: string; mode?: "permit" | "approve" }) {
    return Promise.reject(new Error("Fixture: buildMintTx not implemented"));
  }

  finalizeMintTx(_vaultAddress: string, _req: { units: string; account: string; permits: unknown[] }) {
    return Promise.reject(new Error("Fixture: finalizeMintTx not implemented"));
  }

  buildRedeemTx(_vaultAddress: string, _req: { amount: string; account: string }) {
    return Promise.reject(new Error("Fixture: buildRedeemTx not implemented"));
  }

  buildDeployTx(_req: Record<string, unknown>) {
    return Promise.reject(new Error("Fixture: buildDeployTx not implemented"));
  }

  async previewDeploy(req: PreviewDeployRequest): Promise<DeployPreview> {
    await delay(DELAY_MS);
    const toBase18 = (v: string): string => {
      const [whole, frac = ""] = v.split(".");
      return BigInt(`${whole || "0"}${frac.padEnd(18, "0").slice(0, 18)}`).toString();
    };
    const unitQty =
      req.composition.mode === "quantities"
        ? req.composition.qty.map(toBase18)
        : req.tokens.map(() => "0");
    return {
      unitQty,
      breakdown: req.tokens.map((token, i) => ({
        token,
        symbol: token.slice(0, 6),
        qty: req.composition.mode === "quantities" ? (req.composition.qty[i] ?? "0") : "0",
        valueUsd: "0",
        weightBps: 0,
      })),
      totalValueUsd: "0",
      priceMissing: [],
      predictedVault: "0xfixturevault00000000000000000000000000000",
      gate: { gated: false, reason: "none" },
    };
  }

  buildForwardCreateTx(_vaultAddress: string, _req: { cash: string; account: string }) {
    return Promise.reject(new Error("Fixture: buildForwardCreateTx not implemented"));
  }

  buildForwardRedeemTx(_vaultAddress: string, _req: { shares: string; account: string }) {
    return Promise.reject(new Error("Fixture: buildForwardRedeemTx not implemented"));
  }

  buildForwardCancelTx(_vaultAddress: string, _req: { ticketId: number; account: string }) {
    return Promise.reject(new Error("Fixture: buildForwardCancelTx not implemented"));
  }

  buildCuratorScheduleTx(_vaultAddress: string, _req: { tokens: string[]; unitQty: string[]; account: string }) {
    return Promise.reject(new Error("Fixture: buildCuratorScheduleTx not implemented"));
  }

  buildCuratorActivateTx(_vaultAddress: string, _req: { account: string }) {
    return Promise.reject(new Error("Fixture: buildCuratorActivateTx not implemented"));
  }

  buildKeeperRecordTx(_vaultAddress: string, _req: { account: string }) {
    return Promise.reject(new Error("Fixture: buildKeeperRecordTx not implemented"));
  }

  buildKeeperSettleTx(_vaultAddress: string, _req: { ticketIds: number[]; ap: string; account: string }) {
    return Promise.reject(new Error("Fixture: buildKeeperSettleTx not implemented"));
  }

  buildAuctionOpenTx(
    _vaultAddress: string,
    _req: {
      account: string;
      durationSec: number;
      release: { token: string; releaseOut: string }[];
      acquire: { token: string; startIn: string; endIn: string }[];
    },
  ) {
    return Promise.reject(new Error("Fixture: buildAuctionOpenTx not implemented"));
  }

  buildAuctionBidTx(
    _vaultAddress: string,
    _req: { account: string; acquire: { token: string; amount: string }[] },
  ) {
    return Promise.reject(new Error("Fixture: buildAuctionBidTx not implemented"));
  }

  buildAuctionSetExecModeTx(_vaultAddress: string, _req: { mode: number; account: string }) {
    return Promise.reject(new Error("Fixture: buildAuctionSetExecModeTx not implemented"));
  }

  async getAuctionStatus(vaultAddress: string, _account?: string): Promise<AuctionStatus> {
    await delay(DELAY_MS);
    return { vaultAddress, deployed: false, execMode: 0, openAllow: false, acquireIn: [] };
  }
}
