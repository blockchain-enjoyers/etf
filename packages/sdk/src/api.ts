import type {
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
  EnableRequest,
  ForwardEnableStatus,
  HoldingsResponse,
  AccountHoldingsResponse,
  ActivityEvent,
  AvailabilityResponse,
  MintQuoteResponse,
  TxPlan,
  AuctionStatus,
  PreviewDeployRequest,
  DeployPreview,
  SuggestedFundsResponse,
  ConstituentPrice,
  SceneTamper,
  SceneRead,
} from "./dto.js";

export interface MeridianApi {
  getFeed(): Promise<FeedResponse>;
  listBaskets(): Promise<BasketSummary[]>;
  getBasket(vaultAddress: string): Promise<BasketDetail>;
  getNav(vaultAddress: string): Promise<NavResponse>;
  getMarketPrice(vaultAddress: string): Promise<MarketPrice>;
  getPremiumDiscount(vaultAddress: string): Promise<PremiumDiscount>;
  getHistory(vaultAddress: string, range: HistoryQuery["range"]): Promise<HistoryPoint[]>;
  getRedeemQuote(vaultAddress: string, req: RedeemQuoteRequest): Promise<RedeemQuoteResponse>;
  getRebalanceDetail(vaultAddress: string): Promise<RebalanceDetail>;
  getKeeperStatus(vaultAddress: string): Promise<KeeperStatus>;
  getRebalanceHistory(vaultAddress: string): Promise<RebalanceHistory>;
  getForwardTickets(vaultAddress: string, owner?: string): Promise<ForwardTicket[]>;
  getForwardQueue(vaultAddress: string): Promise<ForwardQueue>;
  getSettleGateStatus(vaultAddress: string): Promise<SettleGateStatus>;
  getForwardHistory(vaultAddress: string): Promise<ForwardHistory>;
  enableCashSettlement(vault: string, body: EnableRequest): Promise<{ status: "pending" }>;
  getForwardEnableStatus(vault: string): Promise<ForwardEnableStatus>;
  getHoldings(vaultAddress: string): Promise<HoldingsResponse>;
  getAccountHoldings(account: string): Promise<AccountHoldingsResponse>;
  getAccountForwardTickets(account: string): Promise<ForwardTicket[]>;
  getAccountActivity(account: string): Promise<ActivityEvent[]>;
  getAvailability(vaultAddress: string, account?: string): Promise<AvailabilityResponse>;
  getMintQuote(vaultAddress: string, req: { units: string; account?: string; mode?: "permit" | "approve" }): Promise<MintQuoteResponse>;
  buildMintTx(vaultAddress: string, req: { units: string; account: string; mode?: "permit" | "approve" }): Promise<TxPlan>;
  finalizeMintTx(vaultAddress: string, req: { units: string; account: string; permits: unknown[] }): Promise<TxPlan>;
  buildRedeemTx(vaultAddress: string, req: { amount: string; account: string }): Promise<TxPlan>;
  buildDeployTx(req: Record<string, unknown>): Promise<TxPlan>;
  buildWrapTx(vaultAddress: string, req: { token: string; amount: string; account: string }): Promise<TxPlan>;
  buildBatchWrapTx(vaultAddress: string, req: { tokens: string[]; amounts: string[]; account: string }): Promise<TxPlan>;
  buildUnwrapTx(vaultAddress: string, req: { token: string; amount: string; to: string; account: string }): Promise<TxPlan>;
  buildSetOperatorTx(vaultAddress: string, req: { operator: string; approved: boolean; account: string }): Promise<TxPlan>;
  buildBootstrapTx(vaultAddress: string, req: { tokens: string[]; unitQty: string[]; unitSize: string; nShares?: string; account: string }): Promise<TxPlan>;
  buildRegistryCreateTx(vaultAddress: string, req: { nShares: string; account: string }): Promise<TxPlan>;
  buildRegistryRedeemTx(vaultAddress: string, req: { amount: string; withUnwrap?: boolean; account: string }): Promise<TxPlan>;
  previewDeploy(req: PreviewDeployRequest): Promise<DeployPreview>;
  buildForwardCreateTx(vaultAddress: string, req: { cash: string; account: string }): Promise<TxPlan>;
  buildForwardRedeemTx(vaultAddress: string, req: { shares: string; account: string }): Promise<TxPlan>;
  buildForwardCancelTx(vaultAddress: string, req: { ticketId: number; account: string }): Promise<TxPlan>;
  buildCuratorScheduleTx(vaultAddress: string, req: { tokens: string[]; unitQty: string[]; account: string }): Promise<TxPlan>;
  buildCuratorActivateTx(vaultAddress: string, req: { account: string }): Promise<TxPlan>;
  buildKeeperRecordTx(vaultAddress: string, req: { account: string }): Promise<TxPlan>;
  buildKeeperSettleTx(vaultAddress: string, req: { ticketIds: number[]; ap: string; account: string }): Promise<TxPlan>;
  buildAuctionOpenTx(
    vaultAddress: string,
    req: {
      account: string;
      durationSec: number;
      release: { token: string; releaseOut: string }[];
      acquire: { token: string; startIn: string; endIn: string }[];
    },
  ): Promise<TxPlan>;
  buildAuctionBidTx(
    vaultAddress: string,
    req: { account: string; acquire: { token: string; amount: string }[] },
  ): Promise<TxPlan>;
  buildAuctionSetExecModeTx(vaultAddress: string, req: { mode: number; account: string }): Promise<TxPlan>;
  getAuctionStatus(vaultAddress: string, account?: string): Promise<AuctionStatus>;
  getSuggestedFunds(): Promise<SuggestedFundsResponse>;
  getConstituentPrices(vault: string): Promise<ConstituentPrice[]>;
  tamperScene(body: SceneTamper): Promise<{ txHash: string }>;
  getScene(token: string): Promise<SceneRead>;
}
