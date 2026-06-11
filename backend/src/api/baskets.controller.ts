import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  type AvailabilityResponse,
  type BasketDetail,
  type BasketSummary,
  type ForwardHistory,
  type ForwardQueue,
  type ForwardTicket,
  type HistoryPoint,
  historyQuerySchema,
  type HoldingsResponse,
  type KeeperStatus,
  type MarketPrice,
  type NavResponse,
  type PremiumDiscount,
  redeemQuoteRequestSchema,
  type RebalanceDetail,
  type RebalanceHistory,
  type RedeemQuoteResponse,
  type SettleGateStatus,
} from "@meridian/sdk";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { RedeemQuotePort } from "../capabilities/redeem-quote/redeem-quote.port.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { TokenMetadataService } from "../contracts/token-metadata.service.js";
import { marketStatusToWire, oracleSourceToWire, severityToWire, vaultTypeToWire } from "../domain/wire.js";
import { AvailabilityService } from "./availability.service.js";
import { ForwardService } from "./forward.service.js";
import { HoldingsService } from "./holdings.service.js";
import { RebalanceService } from "./rebalance.service.js";

/** nestjs-zod DTO classes wrap the SDK schemas for validation + Swagger generation. */
export class HistoryQueryDto extends createZodDto(historyQuerySchema) {}
export class RedeemQuoteRequestDto extends createZodDto(redeemQuoteRequestSchema) {}

const RANGE_MS: Record<string, number> = {
  "1h": 3_600_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
  "1m": 2_592_000_000,
};

@ApiTags("baskets")
@Controller("baskets")
export class BasketsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redeemQuote_: RedeemQuotePort,
    private readonly rebalance: RebalanceService,
    private readonly forward: ForwardService,
    private readonly holdings: HoldingsService,
    private readonly meta: TokenMetadataService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List baskets" })
  async list(): Promise<BasketSummary[]> {
    const rows = await this.prisma.basket.findMany();
    return rows.map((b) => ({
      vaultAddress: b.vaultAddress,
      name: b.name,
      symbol: b.symbol,
      frozen: b.frozen,
      vaultType: vaultTypeToWire(b.vaultType),
      manager: b.manager,
      managerFeeBps: b.managerFeeBps,
      keeperBps: b.keeperBps,
      keeperEscrow: b.keeperEscrow,
    }));
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a basket + its constituents (PCF)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  async getBasket(@Param("id") id: string): Promise<BasketDetail> {
    const b = await this.prisma.basket.findUnique({
      where: { vaultAddress: id },
      include: { constituents: true },
    });
    if (!b) throw new NotFoundException(`basket ${id} not found`);
    const meta = await this.meta.getMany(b.constituents.map((c) => c.token));
    return {
      vaultAddress: b.vaultAddress,
      name: b.name,
      symbol: b.symbol,
      frozen: b.frozen,
      vaultType: vaultTypeToWire(b.vaultType),
      manager: b.manager,
      managerFeeBps: b.managerFeeBps,
      keeperBps: b.keeperBps,
      keeperEscrow: b.keeperEscrow,
      recipeCommitment: b.recipeCommitment,
      basketToken: b.basketToken,
      cashToken: b.cashToken,
      // toFixed(0) not toString(): Prisma Decimal.toString() emits scientific notation
      // (e.g. "1e+21") for values >= 1e21, which violates the decimal-string DTO contract.
      unitSize: b.unitSize.toFixed(0),
      constituents: b.constituents.map((c) => {
        const m = meta[c.token.toLowerCase()];
        return { token: c.token, unitQty: c.unitQty.toFixed(0), symbol: m?.symbol, name: m?.name ?? undefined, decimals: m?.decimals };
      }),
    };
  }

  @Get(":id/holdings")
  @ApiOperation({ summary: "Per-constituent holdings (real price/value/weight/drift)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  getHoldings(@Param("id") id: string): Promise<HoldingsResponse> {
    return this.holdings.getHoldings(id);
  }

  @Get(":id/availability")
  @ApiOperation({ summary: "Per-action protocol/market availability (client overlays wallet/chain)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  getAvailability(@Param("id") id: string, @Query("account") account?: string): Promise<AvailabilityResponse> {
    return this.availability.availability(id, account ?? null);
  }

  @Get(":id/nav")
  @ApiOperation({ summary: "Latest NAV snapshot (NavResponse)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  async getNav(@Param("id") id: string): Promise<NavResponse> {
    const snap = await this.prisma.navSnapshot.findFirst({
      where: { vaultAddress: id },
      orderBy: { timestamp: "desc" },
    });
    if (!snap) throw new NotFoundException(`no NAV for basket ${id}`);
    return {
      vaultAddress: snap.vaultAddress,
      nav: snap.nav.toFixed(0),
      confidenceLower: snap.confidenceLower.toFixed(0),
      confidenceUpper: snap.confidenceUpper.toFixed(0),
      marketStatus: marketStatusToWire(snap.marketStatus),
      estimated: snap.estimated,
      source: oracleSourceToWire(snap.source),
      timestampMs: snap.timestamp.getTime(),
      severity: snap.severity ? severityToWire(snap.severity) : undefined,
      safe: snap.safe ?? undefined,
    };
  }

  @Get(":id/market-price")
  @ApiOperation({ summary: "Market price (DEX)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  async marketPrice(@Param("id") id: string): Promise<MarketPrice> {
    const snap = await this.prisma.navSnapshot.findFirst({
      where: { vaultAddress: id },
      orderBy: { timestamp: "desc" },
    });
    if (!snap) throw new NotFoundException(`no market price for basket ${id}`);
    return { vaultAddress: id, marketPrice: snap.nav.toFixed(0), timestampMs: snap.timestamp.getTime() };
  }

  @Get(":id/premium-discount")
  @ApiOperation({ summary: "Premium/discount of market price vs NAV (bps, signed)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  async premiumDiscount(@Param("id") id: string): Promise<PremiumDiscount> {
    const snap = await this.prisma.navSnapshot.findFirst({
      where: { vaultAddress: id },
      orderBy: { timestamp: "desc" },
    });
    if (!snap) throw new NotFoundException(`no NAV for basket ${id}`);
    const nav = snap.nav.toFixed(0);
    return { premiumBps: 0, nav, marketPrice: nav };
  }

  @Get(":id/history")
  @ApiOperation({ summary: "NAV history over a range" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  async history(@Param("id") id: string, @Query() query: HistoryQueryDto): Promise<HistoryPoint[]> {
    const since = new Date(Date.now() - (RANGE_MS[query.range] ?? RANGE_MS["1d"]!));
    const rows = await this.prisma.navSnapshot.findMany({
      where: { vaultAddress: id, timestamp: { gte: since } },
      orderBy: { timestamp: "asc" },
    });
    return rows.map((r) => ({
      timestampMs: r.timestamp.getTime(),
      nav: r.nav.toFixed(0),
      estimated: r.estimated,
    }));
  }

  @Get(":id/rebalance/history")
  @ApiOperation({ summary: "Rebalance swap history" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  getRebalanceHistory(@Param("id") id: string): Promise<RebalanceHistory> {
    return this.rebalance.getRebalanceHistory(id);
  }

  @Get(":id/rebalance")
  @ApiOperation({ summary: "Rebalance detail (held vs target, pending target, drift)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  getRebalance(@Param("id") id: string): Promise<RebalanceDetail> {
    return this.rebalance.getRebalanceDetail(id);
  }

  @Get(":id/keeper")
  @ApiOperation({ summary: "Keeper escrow + payout history" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  getKeeper(@Param("id") id: string): Promise<KeeperStatus> {
    return this.rebalance.getKeeperStatus(id);
  }

  @Get(":id/forward/tickets")
  @ApiOperation({ summary: "Forward-cash tickets (optionally filtered by owner)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  getForwardTickets(@Param("id") id: string, @Query("owner") owner?: string): Promise<ForwardTicket[]> {
    return this.forward.getTickets(id, owner);
  }

  @Get(":id/forward/queue")
  @ApiOperation({ summary: "Forward-cash pending queue + per-window create capacity" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  getForwardQueue(@Param("id") id: string): Promise<ForwardQueue> {
    return this.forward.getQueue(id);
  }

  @Get(":id/forward/gate")
  @ApiOperation({ summary: "Settle-gate readiness (g0–g8, decision-only, estimated:true)" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  getForwardGate(@Param("id") id: string): Promise<SettleGateStatus> {
    return this.forward.getGateStatus(id);
  }

  @Get(":id/forward/history")
  @ApiOperation({ summary: "Forward-cash event history" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  getForwardHistory(@Param("id") id: string): Promise<ForwardHistory> {
    return this.forward.getHistory(id);
  }

  @Post(":id/redeem-quote")
  @ApiOperation({ summary: "In-kind redeem quote (live previewRedeem) + value-settle gate state" })
  @ApiParam({ name: "id", description: "vaultAddress (0x address)" })
  @ApiOkResponse({ description: "assets + gateState (IRON RULE: estimated NAV gates value-settled ops)" })
  async redeemQuote(
    @Param("id") id: string,
    @Body() body: RedeemQuoteRequestDto,
  ): Promise<RedeemQuoteResponse> {
    const basket = await this.prisma.basket.findUnique({ where: { vaultAddress: id } });
    if (!basket) throw new NotFoundException(`basket ${id} not found`);
    const snap = await this.prisma.navSnapshot.findFirst({
      where: { vaultAddress: id },
      orderBy: { timestamp: "desc" },
    });

    const amount = BigInt(body.basketTokenAmount.split(".")[0]! || "0");
    let assets: RedeemQuoteResponse["assets"];
    try {
      const quoted = await this.redeemQuote_.quote(id as `0x${string}`, amount);
      assets = quoted.map((a) => ({ token: a.token, amount: a.amount.toString() }));
    } catch (err) {
      if (err instanceof CapabilityUnavailableError) {
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

    const meta = await this.meta.getMany(assets.map((a) => a.token));
    assets = await Promise.all(assets.map(async (a) => {
      const m = meta[a.token.toLowerCase()];
      const snap = await this.prisma.priceSnapshot.findFirst({ where: { token: a.token }, orderBy: { timestamp: "desc" } });
      const price = snap ? BigInt(snap.price.toFixed(0)) : 0n;
      const valueUsd = m ? ((BigInt(a.amount) * price) / 10n ** BigInt(m.decimals)).toString() : undefined;
      return { token: a.token, amount: a.amount, symbol: m?.symbol, valueUsd };
    }));

    const reason: RedeemQuoteResponse["gateState"]["reason"] = basket.frozen
      ? "frozen"
      : snap?.estimated
        ? "estimated"
        : "none";
    return { assets, gateState: { gated: reason !== "none", reason } };
  }
}
