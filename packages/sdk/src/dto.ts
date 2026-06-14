import { z } from "zod";

/**
 * DTO contract — the single source of truth (spec §7).
 * Backend imports these schemas for nestjs-zod validation; frontend imports the z.infer types.
 * Decimals are string-encoded (18-dec USD) so JSON never loses precision (IRON RULE: see estimated).
 */

// String literals mirror MeridianTypes.MarketStatus / OracleSource (lowercased over the wire).
export const marketStatusSchema = z.enum([
  "unknown",
  "preMarket",
  "regular",
  "postMarket",
  "overnight",
  "closed",
]);
export type MarketStatus = z.infer<typeof marketStatusSchema>;

export const oracleSourceSchema = z.enum([
  "chainlink",
  "pyth",
  "redstone",
  "dexTwap",
  "perpMark",
  "lastClose",
]);
export type OracleSource = z.infer<typeof oracleSourceSchema>;

export const vaultTypeSchema = z.enum(["basket", "managed", "committed", "rebalance", "registry"]);
export type VaultType = z.infer<typeof vaultTypeSchema>;

export const oracleSeveritySchema = z.enum(["open", "degraded", "halted", "closed", "unknown"]);
export type OracleSeverity = z.infer<typeof oracleSeveritySchema>;

/** 18-dec USD as a decimal string. */
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "expected a decimal string");

export const navResponseSchema = z.object({
  vaultAddress: z.string(),
  nav: decimalString,
  confidenceLower: decimalString,
  confidenceUpper: decimalString,
  marketStatus: marketStatusSchema,
  estimated: z.boolean(), // IRON RULE: true => never a settlement price
  source: oracleSourceSchema,
  timestampMs: z.number().int().nonnegative(),
  severity: oracleSeveritySchema.optional(),
  safe: z.boolean().optional(),
});
export type NavResponse = z.infer<typeof navResponseSchema>;

export const constituentDtoSchema = z.object({
  token: z.string(),
  unitQty: decimalString,
  symbol: z.string().optional(),
  name: z.string().optional(),
  decimals: z.number().int().nonnegative().optional(),
});
export type ConstituentDto = z.infer<typeof constituentDtoSchema>;

export const holdingRowSchema = z.object({
  token: z.string(),
  symbol: z.string(),
  name: z.string().nullable(),
  decimals: z.number().int().nonnegative(),
  qtyPerUnit: decimalString,
  priceUsd: decimalString,
  valuePerUnitUsd: decimalString,
  currentWeightBps: z.number().int(),
  targetWeightBps: z.number().int(),
  driftBps: z.number().int(),
  estimated: z.boolean(),
});
export type HoldingRow = z.infer<typeof holdingRowSchema>;

export const holdingsResponseSchema = z.object({
  vaultAddress: z.string(),
  navPerUnit: decimalString,
  estimated: z.boolean(),
  timestampMs: z.number().int().nonnegative(),
  holdings: z.array(holdingRowSchema),
});
export type HoldingsResponse = z.infer<typeof holdingsResponseSchema>;

export const basketSummarySchema = z.object({
  vaultAddress: z.string(),
  name: z.string(),
  symbol: z.string(),
  frozen: z.boolean(),
  // Rebalance scheme label (Static / Target ±band / Reconstitution). Optional: the
  // backend may not expose it yet, so the UI falls back to "—".
  weightMethod: z.string().optional(),
  vaultType: vaultTypeSchema.default("basket"),
  manager: z.string().nullable().optional(),
  managerFeeBps: z.number().int().nonnegative().nullable().optional(),
  // Meridian's own annual AUM fee (bps). null/absent when the deployed impl predates the getter.
  platformFeeBps: z.number().int().nonnegative().nullable().optional(),
  keeperBps: z.number().int().nonnegative().nullable().optional(),
  keeperEscrow: z.string().nullable().optional(),
});
export type BasketSummary = z.infer<typeof basketSummarySchema>;

export const basketDetailSchema = basketSummarySchema.extend({
  basketToken: z.string().nullable(),
  cashToken: z.string().nullable(),
  unitSize: decimalString,
  constituents: z.array(constituentDtoSchema),
  recipeCommitment: z.string().nullable().optional(),
  // Registry only: false until the genesis basket is seeded (totalSupply > 0). Absent/true otherwise.
  // Queue-independent, so it reflects bootstrap even before cash settlement is enabled.
  bootstrapped: z.boolean().optional(),
});
export type BasketDetail = z.infer<typeof basketDetailSchema>;

export const marketPriceSchema = z.object({
  vaultAddress: z.string(),
  marketPrice: decimalString,
  timestampMs: z.number().int().nonnegative(),
});
export type MarketPrice = z.infer<typeof marketPriceSchema>;

export const premiumDiscountSchema = z.object({
  premiumBps: z.number().int(), // signed: positive = premium, negative = discount
  nav: decimalString,
  marketPrice: decimalString,
});
export type PremiumDiscount = z.infer<typeof premiumDiscountSchema>;

export const historyPointSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  nav: decimalString,
  estimated: z.boolean(),
});
export type HistoryPoint = z.infer<typeof historyPointSchema>;

export const historyQuerySchema = z.object({
  range: z.enum(["1h", "1d", "1w", "1m"]).default("1d"),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export const redeemQuoteRequestSchema = z.object({
  basketTokenAmount: decimalString,
});
export type RedeemQuoteRequest = z.infer<typeof redeemQuoteRequestSchema>;

export const gateStateSchema = z.object({
  gated: z.boolean(),
  reason: z.enum(["none", "estimated", "frozen", "halted"]),
});
export type GateState = z.infer<typeof gateStateSchema>;

export const redeemQuoteResponseSchema = z.object({
  assets: z.array(z.object({
    token: z.string(),
    amount: decimalString,
    symbol: z.string().optional(),
    valueUsd: decimalString.optional(),
  })),
  gateState: gateStateSchema,
});
export type RedeemQuoteResponse = z.infer<typeof redeemQuoteResponseSchema>;

export const feedItemSchema = z.object({
  vaultAddress: z.string(),
  symbol: z.string(),
  nav: decimalString,
  estimated: z.boolean(),
  marketStatus: marketStatusSchema,
  timestampMs: z.number().int().nonnegative(),
  // Signed 24h change in basis points. Optional: absent until the backend computes it.
  change24hBps: z.number().int().optional(),
});
export type FeedItem = z.infer<typeof feedItemSchema>;

export const feedResponseSchema = z.object({ items: z.array(feedItemSchema) });
export type FeedResponse = z.infer<typeof feedResponseSchema>;

export const demoFrameSchema = z.object({ t: z.number(), v: decimalString });
export type DemoFrame = z.infer<typeof demoFrameSchema>;

export const demoSeriesSchema = z.object({
  id: z.string(),
  event: z.string(),
  name: z.string(),
  frames: z.array(demoFrameSchema),
});
export type DemoSeries = z.infer<typeof demoSeriesSchema>;

/** Unsigned integer string in 18-dec base units (no float, no decimal point on the wire). */
const baseUnitString = z
  .string()
  .regex(/^\d+$/, "must be an unsigned integer string (18-dec base units)");

/** 0x-prefixed hex helper (bytes32 / address / signature). */
const hexString = z.string().regex(/^0x[0-9a-fA-F]+$/, "must be 0x-prefixed hex");

/**
 * Off-chain-fitted, signed closed-market fair value submitted by the beta-fitting
 * pipeline to the backend ingest endpoint/job. The backend verifies the signer + freshness.
 */
export const fairValueAttestationSchema = z.object({
  basketId: hexString,
  nav: baseUnitString,
  lower: baseUnitString,
  upper: baseUnitString,
  /** Unix seconds the off-chain model timestamped the estimate. */
  timestamp: z.number().int().nonnegative(),
  /** Recovered signer address must match the configured attestation signer. */
  signer: hexString,
  /** EIP-712 signature over the fair-value typed data. */
  signature: hexString,
});

export type FairValueAttestationDto = z.infer<typeof fairValueAttestationSchema>;

const tokenBalanceSchema = z.object({ token: z.string(), balance: decimalString });
const tokenAmountSchema = z.object({ token: z.string(), amount: decimalString });

export const rebalanceDetailSchema = z.object({
  vaultAddress: z.string(),
  heldTokens: z.array(tokenBalanceSchema),
  target: z.array(constituentDtoSchema),
  pendingTarget: z
    .object({
      tokens: z.array(constituentDtoSchema),
      effectiveAtMs: z.number().int().nonnegative(),
    })
    .nullable(),
  lastRebalanceAtMs: z.number().int().nonnegative().nullable(),
  drift: z
    .object({
      isDue: z.boolean(),
      triggerBandBps: z.number().int().nonnegative(),
      items: z.array(z.object({ token: z.string(), driftBps: z.number().int() })),
    })
    .nullable(),
  // Basket-token supply (18-dec) so the UI can derive holdings-based deposit previews. Optional.
  totalSupply: decimalString.optional(),
});
export type RebalanceDetail = z.infer<typeof rebalanceDetailSchema>;

export const keeperStatusSchema = z.object({
  escrow: decimalString,
  keeperBps: z.number().int().nonnegative(),
  payouts: z.array(
    z.object({
      to: z.string(),
      amount: decimalString,
      txHash: z.string(),
      timestampMs: z.number().int().nonnegative(),
    }),
  ),
});
export type KeeperStatus = z.infer<typeof keeperStatusSchema>;

export const rebalanceHistorySchema = z.object({
  items: z.array(
    z.object({
      txHash: z.string(),
      blockNumber: z.number().int().nonnegative(),
      recipient: z.string(),
      acquire: z.array(tokenAmountSchema),
      release: z.array(tokenAmountSchema),
      timestampMs: z.number().int().nonnegative(),
    }),
  ),
});
export type RebalanceHistory = z.infer<typeof rebalanceHistorySchema>;

/**
 * L5 forward-cash queue DTOs. amountRaw/remainingRaw are raw INTEGER base-unit strings whose
 * decimals are kind-dependent (create = 6-dec USDC, redeem = 18-dec shares); the FE formats per kind.
 */
export const forwardTicketKindSchema = z.enum(["create", "redeem"]);
export type ForwardTicketKind = z.infer<typeof forwardTicketKindSchema>;

export const forwardTicketStatusSchema = z.enum(["pending", "partial", "settled", "cancelled"]);
export type ForwardTicketStatus = z.infer<typeof forwardTicketStatusSchema>;

export const forwardTicketSchema = z.object({
  id: z.number().int().nonnegative(),
  vaultAddress: z.string(),
  owner: z.string(),
  kind: forwardTicketKindSchema,
  amountRaw: decimalString,
  remainingRaw: decimalString,
  // Cash-leg decimals for a create ticket's amount (USDG 18-dec, MockUSDC 6-dec). Redeem amounts are
  // shares (always 18-dec). Lets the cross-vault Portfolio format without fetching each vault's queue.
  cashDecimals: z.number().int().optional(),
  status: forwardTicketStatusSchema,
  cutoffMs: z.number().int().nonnegative(),
  createdAtMs: z.number().int().nonnegative(),
});
export type ForwardTicket = z.infer<typeof forwardTicketSchema>;

export const settleGateGuardIdSchema = z.enum(["g0", "g1", "g2", "g3", "g6", "g7", "g8"]);
export type SettleGateGuardId = z.infer<typeof settleGateGuardIdSchema>;

export const settleGateGuardSchema = z.object({
  id: settleGateGuardIdSchema,
  ok: z.boolean(),
  reason: z.string().nullable(),
});
export type SettleGateGuard = z.infer<typeof settleGateGuardSchema>;

export const settleGateStatusSchema = z.object({
  open: z.boolean(), // true iff every guard ok
  navPerShare: decimalString.nullable(),
  twap: decimalString.nullable(),
  guards: z.array(settleGateGuardSchema),
  estimated: z.literal(true), // IRON RULE: informational only, never a settlement price
});
export type SettleGateStatus = z.infer<typeof settleGateStatusSchema>;

export const queueCapacitySchema = z.object({
  maxCreateFlowBps: z.number().int().nonnegative(),
  windowCapShares: decimalString.nullable(), // supply*bps/BPS, 18-dec shares; null when uncapped (bps==0)
  pendingCreateCash: decimalString,          // Σ pending+partial CREATE tickets' remaining, 6-dec USDC (exact)
  pendingRedeemShares: decimalString,        // Σ pending+partial REDEEM tickets' remaining, 18-dec (exact)
});
export type QueueCapacity = z.infer<typeof queueCapacitySchema>;

// Registry-vault forward fees: fixed USDG amounts FeeCore applies at settle — create costs the user
// +flatCreateFee, redeem proceeds are −flatRedeemFee. The create/redeem CALLDATA is unchanged; this is
// disclosure so the FE can show honest net amounts. null/absent for managed (non-registry) queues.
// Amounts are raw base units in the fee token's (USDG, 6-dec) decimals.
export const forwardQueueFeesSchema = z.object({
  isRegistry: z.boolean(),
  feeToken: z.string(),
  // Fee-token decimals (USDG is 18-dec, MockUSDC 6-dec) — needed to format flatCreate/RedeemFee. 18 default.
  feeDecimals: z.number().int().default(18),
  flatCreateFee: baseUnitString,
  flatRedeemFee: baseUnitString,
});
export type ForwardQueueFees = z.infer<typeof forwardQueueFeesSchema>;

export const forwardQueueSchema = z.object({
  queueAddress: z.string().nullable(),
  // Cash leg = the queue's stable token. Decimals vary (USDG 18-dec, MockUSDC 6-dec), so the UI must
  // parse the cash amount + estimate with these, not a hardcoded constant. Null/18 when no queue.
  cashToken: z.string().nullable().optional(),
  cashDecimals: z.number().int().optional(),
  tickets: z.array(forwardTicketSchema),
  capacity: queueCapacitySchema,
  fees: forwardQueueFeesSchema.nullable().optional(),
});
export type ForwardQueue = z.infer<typeof forwardQueueSchema>;

export const forwardHistoryKindSchema = z.enum([
  "CreateRequested",
  "RedeemRequested",
  "Cancelled",
  "Settled",
  "PartialFill",
]);
export type ForwardHistoryKind = z.infer<typeof forwardHistoryKindSchema>;

export const forwardHistoryItemSchema = z.object({
  kind: forwardHistoryKindSchema,
  id: z.number().int().nonnegative(),
  txHash: z.string(),
  timestampMs: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.string()),
});
export type ForwardHistoryItem = z.infer<typeof forwardHistoryItemSchema>;

export const forwardHistorySchema = z.object({ items: z.array(forwardHistoryItemSchema) });
export type ForwardHistory = z.infer<typeof forwardHistorySchema>;

export const accountHoldingSchema = z.object({
  vaultAddress: z.string(),
  symbol: z.string(),
  balance: decimalString,
  valueUsd: decimalString,
  estimated: z.boolean(),
});
export type AccountHolding = z.infer<typeof accountHoldingSchema>;
export const accountHoldingsResponseSchema = z.object({
  account: z.string(),
  holdings: z.array(accountHoldingSchema),
});
export type AccountHoldingsResponse = z.infer<typeof accountHoldingsResponseSchema>;

// Per-account activity feed: in-kind mint/redeem + forward lifecycle, newest first. `payload` holds the
// raw amounts (mint: nUnits+minted; redeem: amount; forward: cash/shares/cutoff) for the FE to format.
export const activityKindSchema = z.enum([
  "mint",
  "redeem",
  "forward-create",
  "forward-redeem",
  "forward-fill",
  "forward-settle",
  "forward-cancel",
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const activityEventSchema = z.object({
  vaultAddress: z.string(),
  symbol: z.string(),
  owner: z.string(),
  kind: activityKindSchema,
  payload: z.record(z.string(), z.string()),
  txHash: z.string(),
  timestampMs: z.number().int().nonnegative(),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;

export const txActionSchema = z.enum([
  "mint", "redeemInKind", "deploy",
  "forwardCreate", "forwardRedeem", "forwardCancel",
  "curatorSchedule", "curatorActivate",
  "keeperRecord", "keeperSettle",
  "auctionOpen", "auctionBid", "auctionSetExecMode",
]);
export type TxAction = z.infer<typeof txActionSchema>;

export const availabilityReasonSchema = z.enum([
  "ok", "not-deployed", "frozen", "market-closed", "halted",
  "manager-mismatch", "not-authorized", "nothing-pending",
  "unsupported-vault-type",
]);
export const availabilityItemSchema = z.object({
  action: txActionSchema,
  enabled: z.boolean(),
  reason: availabilityReasonSchema,
});
export const availabilityResponseSchema = z.object({
  vaultAddress: z.string(),
  account: z.string().nullable(),
  items: z.array(availabilityItemSchema),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

export const mintQuoteRequestSchema = z.object({
  units: baseUnitString,
  account: z.string().optional(),
  mode: z.enum(["permit", "approve"]).optional(),
});
export const mintQuoteDepositSchema = z.object({
  token: z.string(), symbol: z.string(),
  amount: decimalString, valueUsd: decimalString,
});
// A fixed USDG fee pulled by the protocol (mint-time flatCreateFee, or the deploy-time per-TYPE
// creation fee). amount is raw base units in the fee token's decimals; valueUsd is 18-dec USD.
export const feeQuoteSchema = z.object({
  token: z.string(),
  symbol: z.string(),
  amount: baseUnitString,
  valueUsd: decimalString,
});
export type FeeQuote = z.infer<typeof feeQuoteSchema>;

// Per-vault fixed USDG flatCreateFee pulled by FeeCore.create(). Optional: absent on the no-op
// fee seam (Basket/Committed) or when the fee is 0.
export const mintQuoteFeeSchema = feeQuoteSchema;
export const mintQuoteResponseSchema = z.object({
  unitsOut: decimalString,
  deposits: z.array(mintQuoteDepositSchema),
  estTotalUsd: decimalString,
  gate: gateStateSchema,
  fee: mintQuoteFeeSchema.optional(),
});
export type MintQuoteResponse = z.infer<typeof mintQuoteResponseSchema>;

const txSendStepBase = {
  to: hexString, data: hexString, value: baseUnitString,
  contractName: z.string(), label: z.string(), summary: z.string(), simulated: z.boolean(),
};
export const permitTypedDataSchema = z.object({
  domain: z.object({
    name: z.string(), version: z.string(),
    chainId: z.number().int(), verifyingContract: hexString,
  }),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.literal("Permit"),
  message: z.object({
    owner: hexString, spender: hexString,
    value: baseUnitString, nonce: baseUnitString, deadline: baseUnitString,
  }),
});
export const txStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approve"), ...txSendStepBase }),
  z.object({ kind: z.literal("call"), ...txSendStepBase }),
  z.object({
    kind: z.literal("sign712"), token: z.string(),
    typedData: permitTypedDataSchema, label: z.string(), summary: z.string(),
  }),
]);
export type TxStep = z.infer<typeof txStepSchema>;
export const txPlanSchema = z.object({
  chainId: z.number().int(),
  gate: gateStateSchema,
  steps: z.array(txStepSchema),
  finalize: z.object({ path: z.string() }).nullable(),
});
export type TxPlan = z.infer<typeof txPlanSchema>;

const addr = z.string();
export const mintTxRequestSchema = mintQuoteRequestSchema;
export const mintFinalizeRequestSchema = z.object({
  units: baseUnitString, account: addr,
  permits: z.array(z.object({
    token: addr, value: baseUnitString, deadline: baseUnitString,
    v: z.number().int(), r: hexString, s: hexString,
  })),
});
export const redeemTxRequestSchema = z.object({ amount: baseUnitString, account: addr });
export const deployTxRequestSchema = z.object({
  account: addr,
  vaultKind: vaultTypeSchema,
  name: z.string(), symbol: z.string(),
  tokens: z.array(addr), unitQty: z.array(baseUnitString), unitSize: baseUnitString,
  manager: addr.optional(), managerFeeBps: z.number().int().optional(),
  keeperBps: z.number().int().optional(), keeperEscrow: addr.optional(),
  userSalt: hexString.optional(),
});
/** Composition of a new vault: literal per-unit quantities, or target weights + a USD notional. */
export const deployCompositionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("quantities"), qty: z.array(decimalString) }),
  z.object({ mode: z.literal("weights"), weightsBps: z.array(z.number().int()), valuePerUnitUsd: decimalString }),
]);
export type DeployComposition = z.infer<typeof deployCompositionSchema>;

export const previewDeployRequestSchema = z.object({
  account: addr,
  vaultKind: vaultTypeSchema,
  name: z.string(), symbol: z.string(),
  tokens: z.array(addr),
  unitSize: decimalString,
  composition: deployCompositionSchema,
  manager: addr.optional(), managerFeeBps: z.number().int().optional(),
  keeperBps: z.number().int().optional(), keeperEscrow: addr.optional(),
  userSalt: hexString.optional(),
});
export type PreviewDeployRequest = z.infer<typeof previewDeployRequestSchema>;

export const previewDeployBreakdownSchema = z.object({
  token: z.string(), symbol: z.string(),
  qty: decimalString, valueUsd: decimalString, weightBps: z.number().int(),
});
export type PreviewDeployBreakdown = z.infer<typeof previewDeployBreakdownSchema>;

/** Free-form revert reason (not the fixed gateStateSchema enum). */
export const previewGateSchema = z.object({ gated: z.boolean(), reason: z.string() });
export type PreviewGate = z.infer<typeof previewGateSchema>;

export const previewDeployResponseSchema = z.object({
  unitQty: z.array(baseUnitString),
  breakdown: z.array(previewDeployBreakdownSchema),
  totalValueUsd: decimalString,
  priceMissing: z.array(z.string()),
  predictedVault: z.string().nullable(),
  gate: previewGateSchema,
  // Fixed USDG fund-creation fee the deployer pays the CloneFactory for this vault TYPE. Omitted when 0.
  creationFee: feeQuoteSchema.optional(),
});
export type DeployPreview = z.infer<typeof previewDeployResponseSchema>;

// --- Registry (5th vault type) AP/holder claim-lifecycle tx requests ---
// The vault custodies constituents as ERC-6909 claims; these drive wrap/unwrap/setOperator/bootstrap +
// in-kind create/redeem. amounts are raw base-unit strings in the constituent's (or share's) decimals.
export const registryWrapTxRequestSchema = z.object({ token: addr, amount: baseUnitString, account: addr });
export const registryBatchWrapTxRequestSchema = z
  .object({ tokens: z.array(addr), amounts: z.array(baseUnitString), account: addr })
  .refine((v) => v.tokens.length === v.amounts.length, { message: "tokens and amounts length mismatch" });
export const registryUnwrapTxRequestSchema = z.object({ token: addr, amount: baseUnitString, to: addr, account: addr });
export const registrySetOperatorTxRequestSchema = z.object({ operator: addr, approved: z.boolean(), account: addr });
export const registryBootstrapTxRequestSchema = z
  .object({
    tokens: z.array(addr),
    unitQty: z.array(baseUnitString),
    unitSize: baseUnitString,
    nShares: baseUnitString.optional(),
    account: addr,
  })
  .refine((v) => v.tokens.length === v.unitQty.length, { message: "tokens and unitQty length mismatch" });
// In-kind create pulls the caller's OWN claims (internal _transfer; no operator needed) and mints
// nShares; the builder prepends wraps for any per-token claim shortfall. Redeem burns shares -> claims,
// then unwraps each to real ERC-20 (set withUnwrap=false to receive bare claims).
export const registryCreateTxRequestSchema = z.object({ nShares: baseUnitString, account: addr });
export const registryRedeemTxRequestSchema = z.object({ amount: baseUnitString, withUnwrap: z.boolean().optional(), account: addr });

export const forwardCreateTxRequestSchema = z.object({ cash: baseUnitString, account: addr });
export const forwardRedeemTxRequestSchema = z.object({ shares: baseUnitString, account: addr });
export const forwardCancelTxRequestSchema = z.object({ ticketId: z.number().int().nonnegative(), account: addr });
export const curatorScheduleTxRequestSchema = z.object({ tokens: z.array(addr), unitQty: z.array(baseUnitString), account: addr });
export const curatorActivateTxRequestSchema = z.object({ account: addr });
export const keeperRecordTxRequestSchema = z.object({ account: addr });
export const keeperSettleTxRequestSchema = z.object({ ticketIds: z.array(z.number().int()), ap: addr, account: addr });
// Open carries the operator-entered Dutch-auction legs from AuctionPanel: release legs (vault sends
// token → releaseOut) and acquire legs (vault receives token, price decays startIn → endIn). amounts
// are 18-dec base-unit strings (the panel parseUnits(_, 18)); the backend maps them to the contract's
// open(vault, release[], releaseOut[], acquire[], startIn[], endIn[], duration) arrays.
export const auctionOpenTxRequestSchema = z.object({
  account: addr,
  durationSec: z.number().int().positive(),
  release: z.array(z.object({ token: addr, releaseOut: baseUnitString })),
  acquire: z.array(z.object({ token: addr, startIn: baseUnitString, endIn: baseUnitString })),
});
// Bid carries the operator-entered acquire tokens paired with their currentAcquireIn amounts (18-dec
// base units) so the backend can emit the approve(token → auction) steps the bid's transferFrom needs;
// the on-chain call itself is bid(vault).
export const auctionBidTxRequestSchema = z.object({
  account: addr,
  acquire: z.array(z.object({ token: addr, amount: baseUnitString })),
});
// Permissionless (2) is contract-disabled (reverts PermissionlessDisabled); only Manager-only (0)
// and Allowlist (1) are settable.
export const auctionSetExecModeTxRequestSchema = z.object({
  mode: z.union([z.literal(0), z.literal(1)]),
  account: addr,
});

export const auctionStatusSchema = z.object({
  vaultAddress: z.string(),
  deployed: z.boolean(),
  execMode: z.number().int(),
  openAllow: z.boolean(),
  acquireIn: z.array(decimalString),
});
export type AuctionStatus = z.infer<typeof auctionStatusSchema>;

// --- Suggested-funds catalog (create-flow recommender) ---
// Static REFERENCE data: real-ETF-replica fund templates produced by tools/registry. Each carries a
// recommended vault kind + a capped sample of holdings (full count in holdingsCount). resolvableTokens
// is the subset whose address exists on the target chain (usually empty on testnet) → pre-fill source.
export const suggestedHoldingSchema = z.object({
  symbol: z.string(),
  weightBps: z.number().int().nonnegative(),
  address: z.string().nullable(),
});
export type SuggestedHolding = z.infer<typeof suggestedHoldingSchema>;

export const suggestedResolvableTokenSchema = z.object({
  token: z.string(),
  symbol: z.string(),
  weightBps: z.number().int().nonnegative(),
});
export type SuggestedResolvableToken = z.infer<typeof suggestedResolvableTokenSchema>;

export const suggestedFundSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  recommendedVaultKind: vaultTypeSchema,
  description: z.string(),
  sampleHoldings: z.array(suggestedHoldingSchema),
  holdingsCount: z.number().int().nonnegative(),
  // Fraction of the source ETF (by weight) the registry actually covers; informational.
  coveragePct: z.number().optional(),
  // The subset of constituents resolvable to on-chain tokens (for wizard pre-fill). Empty => reference-only.
  resolvableTokens: z.array(suggestedResolvableTokenSchema),
});
export type SuggestedFund = z.infer<typeof suggestedFundSchema>;

export const suggestedFundsResponseSchema = z.object({
  funds: z.array(suggestedFundSchema),
});
export type SuggestedFundsResponse = z.infer<typeof suggestedFundsResponseSchema>;

// --- Forward cash-settlement enable (manager-signed) ---
export const enableParamsSchema = z.object({
  minPrints: z.number().int(), twapWindowSec: z.number().int(), twapBandBps: z.number().int(), pegBandBps: z.number().int(),
  pegMaxAgeSec: z.number().int(), cutoffDelaySec: z.number().int(), spreadBps: z.number().int(), capacityBps: z.number().int(),
  keeperTip: baseUnitString, keeperBps: z.number().int(),
});
export type EnableParams = z.infer<typeof enableParamsSchema>;
export const enableRequestSchema = z.object({ params: enableParamsSchema, nonce: z.string(), expiry: z.number().int(), signature: z.string() });
export type EnableRequest = z.infer<typeof enableRequestSchema>;
export const forwardEnableStatusSchema = z.object({
  status: z.enum(["none", "pending", "wiring", "live", "failed"]),
  step: z.string().optional(), queueAddress: z.string().optional(), error: z.string().optional(),
});
export type ForwardEnableStatus = z.infer<typeof forwardEnableStatusSchema>;

// --- Judge price-safety panel: read-only seed prices for the FE sim ---
export const constituentPriceSchema = z.object({ token: z.string(), price: z.string(), sourceCount: z.number().int() });
export const constituentPricesSchema = z.array(constituentPriceSchema);
export type ConstituentPrice = z.infer<typeof constituentPriceSchema>;
export const sceneTamperSchema = z.object({ token: z.string(), price: z.string() });
export type SceneTamper = z.infer<typeof sceneTamperSchema>;
export const sceneReadSchema = z.object({ token: z.string(), mockPrice: z.string() });
export type SceneRead = z.infer<typeof sceneReadSchema>;

// --- Token search + resolve (create-wizard catalog) ---
export const tokenInfoSchema = z.object({ token: z.string(), symbol: z.string(), name: z.string().nullable() });
export type TokenInfo = z.infer<typeof tokenInfoSchema>;
export const tokenInfoListSchema = z.array(tokenInfoSchema);
export const resolveTokensRequestSchema = z.object({ addresses: z.array(z.string()) });

// --- Token balances + demo faucet (in-kind funding check) ---
// Per-token wallet balance plus, for the colleague's mock Stock faucet, the fixed amount it mints and
// how much of the per-address cap is still available (null when the token has no faucet).
export const walletBalanceSchema = z.object({
  token: z.string(),
  symbol: z.string(),
  decimals: z.number().int(),
  balance: baseUnitString,
  faucetAmount: baseUnitString.nullable(),
  faucetRemaining: baseUnitString.nullable(),
});
export type TokenBalance = z.infer<typeof walletBalanceSchema>;
export const tokenBalancesSchema = z.array(walletBalanceSchema);
export const tokenBalancesRequestSchema = z.object({ account: z.string(), tokens: z.array(z.string()) });
export const faucetTxRequestSchema = z.object({ account: addr });
