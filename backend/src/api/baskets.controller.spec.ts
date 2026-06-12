import { Test } from "@nestjs/testing";
import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityUnavailableError } from "../capabilities/capability-unavailable.error.js";
import { RedeemQuotePort } from "../capabilities/redeem-quote/redeem-quote.port.js";
import { PrismaService } from "../persistence/prisma.service.js";
import { TokenMetadataService } from "../contracts/token-metadata.service.js";
import { AvailabilityService } from "./availability.service.js";
import { BasketsController } from "./baskets.controller.js";
import { ForwardService } from "./forward.service.js";
import { HoldingsService } from "./holdings.service.js";
import { RebalanceService } from "./rebalance.service.js";

/** Minimal Decimal-like mock: Prisma Decimal has toFixed() / toString(). */
function dec(s: string) {
  return { toFixed: () => s, toString: () => s };
}

describe("BasketsController", () => {
  let controller: BasketsController;
  let getManyMock: ReturnType<typeof vi.fn>;
  let rebalanceService: { getRebalanceDetail: ReturnType<typeof vi.fn>; getKeeperStatus: ReturnType<typeof vi.fn>; getRebalanceHistory: ReturnType<typeof vi.fn> };
  let forwardService: {
    getTickets: ReturnType<typeof vi.fn>;
    getQueue: ReturnType<typeof vi.fn>;
    getGateStatus: ReturnType<typeof vi.fn>;
    getHistory: ReturnType<typeof vi.fn>;
  };
  const basketRow = {
    vaultAddress: "0xv",
    basketToken: null,
    cashToken: null,
    unitSize: dec("1000"),
    name: "Tech",
    symbol: "mTECH",
    frozen: false,
    vaultType: "Managed",
    manager: "0xm",
    managerFeeBps: 100,
    platformFeeBps: 15,
    recipeCommitment: "0xabc",
    constituents: [{ token: "0xA", unitQty: dec("10") }],
  };
  const findUnique = vi.fn(async () => basketRow);
  const findMany = vi.fn(async () => [basketRow]);
  const navFindFirst = vi.fn(async () => ({
    vaultAddress: "0xv",
    nav: dec("123.0"),
    confidenceLower: dec("120.0"),
    confidenceUpper: dec("126.0"),
    marketStatus: "Closed",
    source: "LastClose",
    estimated: true,
    timestamp: new Date(1_717_000_000_000),
  }));
  const quote = vi.fn(async () => [{ token: "0xA" as const, amount: 5n }]);

  beforeEach(async () => {
    findUnique.mockClear();
    quote.mockClear();
    getManyMock = vi.fn().mockResolvedValue({});
    rebalanceService = {
      getRebalanceDetail: vi.fn(async () => ({})),
      getKeeperStatus: vi.fn(async () => ({})),
      getRebalanceHistory: vi.fn(async () => ({})),
    };
    forwardService = {
      getTickets: vi.fn(async () => []),
      getQueue: vi.fn(async () => ({
        queueAddress: null, tickets: [],
        capacity: { maxCreateFlowBps: 0, windowCapShares: null, pendingCreateCash: "0", pendingRedeemShares: "0" },
      })),
      getGateStatus: vi.fn(async () => ({ open: false, navPerShare: null, twap: null, guards: [], estimated: true })),
      getHistory: vi.fn(async () => ({ items: [] })),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BasketsController,
        {
          provide: PrismaService,
          useValue: {
            basket: { findUnique, findMany },
            navSnapshot: { findFirst: navFindFirst, findMany: vi.fn(async () => [await navFindFirst()]) },
            priceSnapshot: { findFirst: vi.fn(async () => null) },
          },
        },
        { provide: RedeemQuotePort, useValue: { quote } },
        { provide: RebalanceService, useValue: rebalanceService },
        { provide: ForwardService, useValue: forwardService },
        { provide: HoldingsService, useValue: { getHoldings: vi.fn() } },
        { provide: TokenMetadataService, useValue: { getMany: getManyMock } },
        { provide: AvailabilityService, useValue: { availability: vi.fn().mockResolvedValue({ vaultAddress: "0xv", account: null, items: [] }) } },
      ],
    }).compile();
    controller = moduleRef.get(BasketsController);
  });

  it("GET /baskets/:id maps to a BasketDetail keyed on vaultAddress with constituents", async () => {
    const detail = await controller.getBasket("0xv");
    expect(detail.vaultAddress).toBe("0xv");
    expect(detail.symbol).toBe("mTECH");
    expect(detail.unitSize).toBe("1000");
    expect(detail.constituents[0]).toMatchObject({ token: "0xA", unitQty: "10" });
    expect(detail.vaultType).toBe("managed");
    expect(detail.manager).toBe("0xm");
    expect(detail.managerFeeBps).toBe(100);
    expect(detail.platformFeeBps).toBe(15);
    expect(detail.recipeCommitment).toBe("0xabc");
  });

  it("getBasket enriches constituents with symbol/decimals", async () => {
    getManyMock.mockResolvedValueOnce({ "0xa": { token: "0xa", symbol: "TSLA", name: null, decimals: 18 } });
    findUnique.mockResolvedValueOnce({
      ...basketRow,
      constituents: [{ token: "0xA", unitQty: dec("10") }],
    } as never);
    const detail = await controller.getBasket("0xv");
    expect(detail.constituents[0]!.symbol).toBe("TSLA");
    expect(detail.constituents[0]!.decimals).toBe(18);
    expect(detail.constituents[0]!.name).toBeUndefined();
  });

  it("GET /baskets list returns vaultType for each basket", async () => {
    const list = await controller.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.vaultType).toBe("managed");
    expect(list[0]!.manager).toBe("0xm");
    expect(list[0]!.managerFeeBps).toBe(100);
    expect(list[0]!.platformFeeBps).toBe(15);
  });

  it("404s on an unknown basket", async () => {
    findUnique.mockResolvedValueOnce(null as never);
    await expect(controller.getBasket("0xmissing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("GET /baskets/:id/nav returns a lowercased NavResponse keyed on vaultAddress carrying estimated", async () => {
    const nav = await controller.getNav("0xv");
    expect(nav.vaultAddress).toBe("0xv");
    expect(nav.nav).toBe("123.0");
    expect(nav.marketStatus).toBe("closed");
    expect(nav.source).toBe("lastClose");
    expect(nav.estimated).toBe(true);
  });

  it("GET /baskets/:id/nav surfaces severity + safe when the snapshot carries them", async () => {
    navFindFirst.mockResolvedValueOnce({
      vaultAddress: "0xv",
      nav: dec("500.0"),
      confidenceLower: dec("490.0"),
      confidenceUpper: dec("510.0"),
      marketStatus: "Regular",
      source: "Chainlink",
      estimated: false,
      timestamp: new Date(1_717_000_000_000),
      severity: "Open",
      safe: true,
    } as never);
    const nav = await controller.getNav("0xv");
    expect(nav.severity).toBe("open");
    expect(nav.safe).toBe(true);
  });

  it("redeem-quote serves assets from RedeemQuotePort and gates value-settled ops when NAV is estimated", async () => {
    const res = await controller.redeemQuote("0xv", { basketTokenAmount: "1000" });
    expect(quote).toHaveBeenCalledWith("0xv", 1000n);
    expect(res.assets[0]).toMatchObject({ token: "0xA", amount: "5" });
    expect(res.gateState.gated).toBe(true);
    expect(res.gateState.reason).toBe("estimated");
  });

  it("redeem-quote maps CapabilityUnavailableError to 503", async () => {
    quote.mockRejectedValueOnce(new CapabilityUnavailableError("BasketVault"));
    await expect(controller.redeemQuote("0xv", { basketTokenAmount: "1000" })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("getBasket returns keeperBps/keeperEscrow for a rebalance vault", async () => {
    findUnique.mockResolvedValueOnce({
      vaultAddress: "0xv", name: "R", symbol: "R", frozen: false, vaultType: "Rebalance",
      manager: "0xm", managerFeeBps: 50, keeperBps: 1000, keeperEscrow: "0xk",
      recipeCommitment: "0xrc", basketToken: null, cashToken: null,
      unitSize: { toFixed: () => "1000" }, constituents: [],
    } as never);
    const d = await controller.getBasket("0xv");
    expect(d.vaultType).toBe("rebalance");
    expect(d.keeperBps).toBe(1000);
    expect(d.keeperEscrow).toBe("0xk");
  });

  it("delegates rebalance endpoints to RebalanceService", async () => {
    await controller.getRebalance("0xv");
    expect(rebalanceService.getRebalanceDetail).toHaveBeenCalledWith("0xv");
    await controller.getKeeper("0xv");
    expect(rebalanceService.getKeeperStatus).toHaveBeenCalledWith("0xv");
    await controller.getRebalanceHistory("0xv");
    expect(rebalanceService.getRebalanceHistory).toHaveBeenCalledWith("0xv");
  });

  it("delegates forward endpoints to ForwardService", async () => {
    await controller.getForwardTickets("0xv", "0xo");
    expect(forwardService.getTickets).toHaveBeenCalledWith("0xv", "0xo");
    await controller.getForwardQueue("0xv");
    expect(forwardService.getQueue).toHaveBeenCalledWith("0xv");
    await controller.getForwardGate("0xv");
    expect(forwardService.getGateStatus).toHaveBeenCalledWith("0xv");
    await controller.getForwardHistory("0xv");
    expect(forwardService.getHistory).toHaveBeenCalledWith("0xv");
  });
});
