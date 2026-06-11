import { z } from "zod";
import {
  feedResponseSchema,
  basketSummarySchema,
  basketDetailSchema,
  navResponseSchema,
  marketPriceSchema,
  premiumDiscountSchema,
  historyPointSchema,
  redeemQuoteResponseSchema,
  rebalanceDetailSchema,
  keeperStatusSchema,
  rebalanceHistorySchema,
  forwardTicketSchema,
  forwardQueueSchema,
  settleGateStatusSchema,
  forwardHistorySchema,
  holdingsResponseSchema,
  accountHoldingsResponseSchema,
  availabilityResponseSchema,
  mintQuoteResponseSchema,
  txPlanSchema,
  auctionStatusSchema,
  previewDeployResponseSchema,
  type FeedResponse,
  type BasketSummary,
  type BasketDetail,
  type NavResponse,
  type MarketPrice,
  type PremiumDiscount,
  type HistoryPoint,
  type HistoryQuery,
  type RedeemQuoteRequest,
  type RedeemQuoteResponse,
  type RebalanceDetail,
  type KeeperStatus,
  type RebalanceHistory,
  type ForwardTicket,
  type ForwardQueue,
  type SettleGateStatus,
  type ForwardHistory,
  type HoldingsResponse,
  type AccountHoldingsResponse,
  type AvailabilityResponse,
  type MintQuoteResponse,
  type TxPlan,
  type AuctionStatus,
  type PreviewDeployRequest,
  type DeployPreview,
} from "./dto.js";
import { ApiError, CapabilityUnavailableError } from "./errors.js";
import type { MeridianApi } from "./api.js";

export interface MeridianClientConfig {
  baseUrl: string;
}

async function parseResponse<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  if (res.status === 503) {
    throw new CapabilityUnavailableError(await res.text().catch(() => "Capability unavailable"));
  }
  if (!res.ok) {
    throw new ApiError(res.status, await res.text().catch(() => res.statusText));
  }
  return schema.parse(await res.json());
}

export class MeridianClient implements MeridianApi {
  private readonly baseUrl: string;

  constructor(config: MeridianClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
  }

  async getFeed(): Promise<FeedResponse> {
    const res = await fetch(`${this.baseUrl}/feed`);
    return parseResponse(res, feedResponseSchema);
  }

  async listBaskets(): Promise<BasketSummary[]> {
    const res = await fetch(`${this.baseUrl}/baskets`);
    return parseResponse(res, z.array(basketSummarySchema));
  }

  async getBasket(vaultAddress: string): Promise<BasketDetail> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}`);
    return parseResponse(res, basketDetailSchema);
  }

  async getNav(vaultAddress: string): Promise<NavResponse> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/nav`);
    return parseResponse(res, navResponseSchema);
  }

  async getMarketPrice(vaultAddress: string): Promise<MarketPrice> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/market-price`);
    return parseResponse(res, marketPriceSchema);
  }

  async getPremiumDiscount(vaultAddress: string): Promise<PremiumDiscount> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/premium-discount`);
    return parseResponse(res, premiumDiscountSchema);
  }

  async getHistory(vaultAddress: string, range: HistoryQuery["range"]): Promise<HistoryPoint[]> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/history?range=${range}`);
    return parseResponse(res, z.array(historyPointSchema));
  }

  async getRedeemQuote(
    vaultAddress: string,
    req: RedeemQuoteRequest,
  ): Promise<RedeemQuoteResponse> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/redeem-quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, redeemQuoteResponseSchema);
  }

  async getRebalanceDetail(vaultAddress: string): Promise<RebalanceDetail> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/rebalance`);
    return parseResponse(res, rebalanceDetailSchema);
  }

  async getKeeperStatus(vaultAddress: string): Promise<KeeperStatus> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/keeper`);
    return parseResponse(res, keeperStatusSchema);
  }

  async getRebalanceHistory(vaultAddress: string): Promise<RebalanceHistory> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/rebalance/history`);
    return parseResponse(res, rebalanceHistorySchema);
  }

  async getForwardTickets(vaultAddress: string, owner?: string): Promise<ForwardTicket[]> {
    const q = owner ? `?owner=${owner}` : "";
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/forward/tickets${q}`);
    return parseResponse(res, z.array(forwardTicketSchema));
  }

  async getForwardQueue(vaultAddress: string): Promise<ForwardQueue> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/forward/queue`);
    return parseResponse(res, forwardQueueSchema);
  }

  async getSettleGateStatus(vaultAddress: string): Promise<SettleGateStatus> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/forward/gate`);
    return parseResponse(res, settleGateStatusSchema);
  }

  async getForwardHistory(vaultAddress: string): Promise<ForwardHistory> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/forward/history`);
    return parseResponse(res, forwardHistorySchema);
  }

  async getHoldings(vaultAddress: string): Promise<HoldingsResponse> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/holdings`);
    return parseResponse(res, holdingsResponseSchema);
  }

  async getAccountHoldings(account: string): Promise<AccountHoldingsResponse> {
    const res = await fetch(`${this.baseUrl}/accounts/${account}/holdings`);
    return parseResponse(res, accountHoldingsResponseSchema);
  }

  async getAvailability(vaultAddress: string, account?: string): Promise<AvailabilityResponse> {
    const q = account ? `?account=${account}` : "";
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/availability${q}`);
    return parseResponse(res, availabilityResponseSchema);
  }

  async getMintQuote(
    vaultAddress: string,
    req: { units: string; account?: string; mode?: "permit" | "approve" },
  ): Promise<MintQuoteResponse> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/mint-quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, mintQuoteResponseSchema);
  }

  async buildMintTx(
    vaultAddress: string,
    req: { units: string; account: string; mode?: "permit" | "approve" },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async finalizeMintTx(
    vaultAddress: string,
    req: { units: string; account: string; permits: unknown[] },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/mint/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildRedeemTx(
    vaultAddress: string,
    req: { amount: string; account: string },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildDeployTx(req: Record<string, unknown>): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/tx/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async previewDeploy(req: PreviewDeployRequest): Promise<DeployPreview> {
    const res = await fetch(`${this.baseUrl}/tx/preview-deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, previewDeployResponseSchema);
  }

  async buildForwardCreateTx(
    vaultAddress: string,
    req: { cash: string; account: string },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/forward/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildForwardRedeemTx(
    vaultAddress: string,
    req: { shares: string; account: string },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/forward/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildForwardCancelTx(
    vaultAddress: string,
    req: { ticketId: number; account: string },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/forward/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildCuratorScheduleTx(
    vaultAddress: string,
    req: { tokens: string[]; unitQty: string[]; account: string },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/curator/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildCuratorActivateTx(
    vaultAddress: string,
    req: { account: string },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/curator/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildKeeperRecordTx(
    vaultAddress: string,
    req: { account: string },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/keeper/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildKeeperSettleTx(
    vaultAddress: string,
    req: { ticketIds: number[]; ap: string; account: string },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/keeper/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildAuctionOpenTx(
    vaultAddress: string,
    req: {
      account: string;
      durationSec: number;
      release: { token: string; releaseOut: string }[];
      acquire: { token: string; startIn: string; endIn: string }[];
    },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/auction/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildAuctionBidTx(
    vaultAddress: string,
    req: { account: string; acquire: { token: string; amount: string }[] },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/auction/bid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async buildAuctionSetExecModeTx(
    vaultAddress: string,
    req: { mode: number; account: string },
  ): Promise<TxPlan> {
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/tx/auction/set-exec-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return parseResponse(res, txPlanSchema);
  }

  async getAuctionStatus(vaultAddress: string, account?: string): Promise<AuctionStatus> {
    const q = account ? `?account=${account}` : "";
    const res = await fetch(`${this.baseUrl}/baskets/${vaultAddress}/auction${q}`);
    return parseResponse(res, auctionStatusSchema);
  }
}
