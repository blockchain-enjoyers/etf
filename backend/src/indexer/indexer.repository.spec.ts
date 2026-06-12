import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../persistence/prisma.service.js";
import {
  type BasketCreatedEvent,
  type ForwardTicketEvent,
  IndexerRepository,
  recipeCommitment,
} from "./indexer.repository.js";

function fakeTokenMeta() {
  return { getMany: vi.fn().mockResolvedValue({}) };
}

function fakePrisma() {
  const basketUpsert = vi.fn(async (a: unknown) => a);
  const constituentUpsert = vi.fn(async (a: unknown) => a);
  const $transaction = vi.fn(async (ops: unknown[]) => ops);
  return {
    spy: { basketUpsert, constituentUpsert, $transaction },
    prisma: {
      $transaction,
      basket: { upsert: basketUpsert },
      constituent: { upsert: constituentUpsert },
    } as unknown as PrismaService,
  };
}

describe("IndexerRepository", () => {
  const event: BasketCreatedEvent = {
    vaultAddress: "0xVault",
    creator: "0xCreator",
    unitSize: 1_000n,
    name: "Mix",
    symbol: "mMIX",
    constituents: [
      { token: "0xA", unitQty: 10n },
      { token: "0xUSDC", unitQty: 20n },
    ],
    recipeCommitment: "0xdeadbeef",
  };

  it("upserts the basket keyed on vaultAddress and each constituent by vaultAddress_token", async () => {
    const { spy, prisma } = fakePrisma();
    const repo = new IndexerRepository(prisma, fakeTokenMeta() as never);
    await repo.applyBasketCreated(event);

    expect(spy.$transaction).toHaveBeenCalledOnce();
    expect(spy.basketUpsert).toHaveBeenCalledOnce();
    const basketArg = spy.basketUpsert.mock.calls[0]![0] as {
      where: { vaultAddress: string };
      create: { vaultAddress: string; unitSize: string; name: string; symbol: string; vaultType: string; recipeCommitment: string };
    };
    expect(basketArg.where).toEqual({ vaultAddress: "0xVault" });
    expect(basketArg.create.vaultAddress).toBe("0xVault");
    expect(basketArg.create.unitSize).toBe("1000");
    expect(basketArg.create.vaultType).toBe("Basket");
    expect(basketArg.create.recipeCommitment).toBe("0xdeadbeef");

    expect(spy.constituentUpsert).toHaveBeenCalledTimes(2);
    const c0 = spy.constituentUpsert.mock.calls[0]![0] as {
      where: { vaultAddress_token: { vaultAddress: string; token: string } };
      create: { vaultAddress: string; token: string; unitQty: string };
    };
    expect(c0.where.vaultAddress_token).toEqual({ vaultAddress: "0xVault", token: "0xA" });
    expect(c0.create.unitQty).toBe("10");
  });

  it("warms the token-metadata cache with constituent token addresses after upsert", async () => {
    const { prisma } = fakePrisma();
    const tokenMeta = fakeTokenMeta();
    const repo = new IndexerRepository(prisma, tokenMeta as never);
    await repo.applyBasketCreated(event);
    expect(tokenMeta.getMany).toHaveBeenCalledOnce();
    expect(tokenMeta.getMany).toHaveBeenCalledWith(["0xA", "0xUSDC"]);
  });

  it("does not throw if token-metadata cache warm fails", async () => {
    const { prisma } = fakePrisma();
    const tokenMeta = { getMany: vi.fn().mockRejectedValue(new Error("network")) };
    const repo = new IndexerRepository(prisma, tokenMeta as never);
    await expect(repo.applyBasketCreated(event)).resolves.toBeUndefined();
  });
});

describe("recipeCommitment helper", () => {
  it("returns a 32-byte hash for a recipe", () => {
    const c = recipeCommitment(
      ["0x0000000000000000000000000000000000000001"],
      [1000000000000000000n],
      1000000000000000000n,
    );
    expect(c).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("applyManagedBasketCreated", () => {
  it("upserts a basket with vaultType Managed + manager + fee", async () => {
    const upsert = vi.fn().mockReturnValue({});
    const prisma = {
      $transaction: vi.fn().mockResolvedValue(undefined),
      basket: { upsert },
      constituent: { upsert: vi.fn().mockReturnValue({}) },
    } as unknown as ConstructorParameters<typeof IndexerRepository>[0];
    const repo = new IndexerRepository(prisma, fakeTokenMeta() as never);
    await repo.applyManagedBasketCreated({
      vaultAddress: "0xv", creator: "0xc", manager: "0xm", managerFeeBps: 100, platformFeeBps: 15,
      unitSize: 1n, name: "N", symbol: "S",
      constituents: [{ token: "0xt", unitQty: 1n }],
      recipeCommitment: "0xabc",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          vaultType: "Managed", manager: "0xm", managerFeeBps: 100, platformFeeBps: 15,
        }),
      }),
    );
  });

  it("writes platformFeeBps=null when the read reverted (deployed impl predates the getter)", async () => {
    const upsert = vi.fn().mockReturnValue({});
    const prisma = {
      $transaction: vi.fn().mockResolvedValue(undefined),
      basket: { upsert },
      constituent: { upsert: vi.fn().mockReturnValue({}) },
    } as unknown as ConstructorParameters<typeof IndexerRepository>[0];
    const repo = new IndexerRepository(prisma, fakeTokenMeta() as never);
    await repo.applyManagedBasketCreated({
      vaultAddress: "0xv", creator: "0xc", manager: "0xm", managerFeeBps: 100, platformFeeBps: null,
      unitSize: 1n, name: "N", symbol: "S",
      constituents: [{ token: "0xt", unitQty: 1n }],
      recipeCommitment: "0xabc",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ platformFeeBps: null }) }),
    );
  });
});

describe("applyRebalanceBasketCreated", () => {
  it("upserts Basket with Rebalance type + keeper fields", async () => {
    const upsert = vi.fn();
    const prisma = {
      $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
      basket: { upsert },
      constituent: { upsert: vi.fn() },
    };
    const repo = new IndexerRepository(prisma as never, fakeTokenMeta() as never);
    await repo.applyRebalanceBasketCreated({
      vaultAddress: "0xv",
      creator: "0xc",
      manager: "0xm",
      managerFeeBps: 50,
      platformFeeBps: 15,
      keeperBps: 1000,
      keeperEscrow: "0xk",
      unitSize: 1000n,
      name: "R",
      symbol: "R",
      constituents: [{ token: "0xt", unitQty: 1n }],
      recipeCommitment: "0xrc",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          vaultType: "Rebalance", keeperBps: 1000, keeperEscrow: "0xk", platformFeeBps: 15,
        }),
      }),
    );
  });
});

describe("applyRegistryIndexCreated", () => {
  it("upserts Basket with Registry type, manager + fees, and EMPTY constituents", async () => {
    const basketUpsert = vi.fn();
    const constituentUpsert = vi.fn();
    const prisma = {
      $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
      basket: { upsert: basketUpsert },
      constituent: { upsert: constituentUpsert },
    };
    const repo = new IndexerRepository(prisma as never, fakeTokenMeta() as never);
    await repo.applyRegistryIndexCreated({
      vaultAddress: "0xreg",
      creator: "0xc",
      manager: "0xm",
      managerFeeBps: 50,
      platformFeeBps: 15,
      keeperBps: 1000,
      keeperEscrow: "0xk",
      unitSize: 1000n,
      name: "SP500",
      symbol: "SP5",
      constituents: [],
      recipeCommitment: "0xroot",
    });
    expect(basketUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          vaultType: "Registry", manager: "0xm", managerFeeBps: 50,
          keeperBps: 1000, keeperEscrow: "0xk", platformFeeBps: 15,
          recipeCommitment: "0xroot",
        }),
      }),
    );
    // Constituents are populated in a later slice — none written at creation.
    expect(constituentUpsert).not.toHaveBeenCalled();
  });
});

describe("replaceRegistryConstituents", () => {
  function fakeReplacePrisma() {
    const deleteMany = vi.fn(async (a: unknown) => a);
    const constituentUpsert = vi.fn(async (a: unknown) => a);
    const $transaction = vi.fn(async (ops: unknown[]) => ops);
    return {
      spy: { deleteMany, constituentUpsert, $transaction },
      prisma: {
        $transaction,
        constituent: { deleteMany, upsert: constituentUpsert },
      } as unknown as PrismaService,
    };
  }

  it("upserts each constituent of the new recipe keyed by vaultAddress_token", async () => {
    const { spy, prisma } = fakeReplacePrisma();
    const repo = new IndexerRepository(prisma, fakeTokenMeta() as never);
    await repo.replaceRegistryConstituents({
      vaultAddress: "0xReg",
      constituents: [
        { token: "0xA", unitQty: 5n },
        { token: "0xB", unitQty: 6n },
      ],
    });
    expect(spy.$transaction).toHaveBeenCalledOnce();
    expect(spy.constituentUpsert).toHaveBeenCalledTimes(2);
    const c0 = spy.constituentUpsert.mock.calls[0]![0] as {
      where: { vaultAddress_token: { vaultAddress: string; token: string } };
      create: { unitQty: string };
    };
    expect(c0.where.vaultAddress_token).toEqual({ vaultAddress: "0xReg", token: "0xA" });
    expect(c0.create.unitQty).toBe("5");
  });

  it("prunes constituents NOT in the new recipe (a reconstitution that drops a token)", async () => {
    const { spy, prisma } = fakeReplacePrisma();
    const repo = new IndexerRepository(prisma, fakeTokenMeta() as never);
    await repo.replaceRegistryConstituents({
      vaultAddress: "0xReg",
      constituents: [{ token: "0xA", unitQty: 5n }], // 0xB dropped vs a prior {0xA,0xB}
    });
    expect(spy.deleteMany).toHaveBeenCalledOnce();
    const arg = spy.deleteMany.mock.calls[0]![0] as {
      where: { vaultAddress: string; token: { notIn: string[] } };
    };
    // delete everything for the vault whose token is NOT the surviving 0xA → prunes 0xB.
    expect(arg.where.vaultAddress).toBe("0xReg");
    expect(arg.where.token.notIn).toEqual(["0xA"]);
  });
});

function fakeForwardPrisma() {
  const tickets = new Map<string, Record<string, unknown>>();
  const events: Record<string, unknown>[] = [];
  const activity: Record<string, unknown>[] = [];
  return {
    _tickets: tickets,
    _events: events,
    _activity: activity,
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    forwardTicket: {
      upsert: vi.fn(async ({ where, create, update }: {
        where: { queueAddress_ticketId: { queueAddress: string; ticketId: number } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const k = `${where.queueAddress_ticketId.queueAddress}:${where.queueAddress_ticketId.ticketId}`;
        const existing = tickets.get(k);
        tickets.set(k, existing ? { ...existing, ...update } : { ...create });
        return tickets.get(k);
      }),
      findUnique: vi.fn(async ({ where }: {
        where: { queueAddress_ticketId: { queueAddress: string; ticketId: number } };
      }) => {
        const k = `${where.queueAddress_ticketId.queueAddress}:${where.queueAddress_ticketId.ticketId}`;
        return tickets.get(k) ?? null;
      }),
    },
    forwardEvent: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        events.push(create);
        return create;
      }),
    },
    activityEvent: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        activity.push(create);
        return create;
      }),
    },
  };
}

function ev(over: Partial<ForwardTicketEvent>): ForwardTicketEvent {
  return {
    vaultAddress: "0xv",
    queueAddress: "0xq",
    ticketId: 0,
    kind: "CreateRequested",
    owner: "0xo",
    amount: 1_000_000n,
    remaining: 1_000_000n,
    cutoffMs: 1_000_000,
    txHash: "0xh",
    logIndex: 0,
    blockNumber: 1n,
    timestampMs: 500,
    payload: {},
    ...over,
  };
}

describe("IndexerRepository.applyForwardEvent", () => {
  let prisma: ReturnType<typeof fakeForwardPrisma>;
  let repo: IndexerRepository;
  beforeEach(() => {
    prisma = fakeForwardPrisma();
    repo = new IndexerRepository(prisma as never, fakeTokenMeta() as never);
  });

  it("CreateRequested -> Pending ticket with amount==remaining", async () => {
    await repo.applyForwardEvent(ev({ kind: "CreateRequested" }));
    const t = prisma._tickets.get("0xq:0")!;
    expect(t.status).toBe("Pending");
    expect(t.kind).toBe("Create");
    expect(t.amount).toBe("1000000");
    expect(t.remaining).toBe("1000000");
  });

  it("RedeemRequested -> Pending Redeem ticket", async () => {
    await repo.applyForwardEvent(ev({ kind: "RedeemRequested", amount: 5n, remaining: 5n }));
    expect(prisma._tickets.get("0xq:0")!.kind).toBe("Redeem");
  });

  it("PartialFill -> Partial, decremented remaining, refreshed cutoff", async () => {
    await repo.applyForwardEvent(ev({ kind: "CreateRequested" }));
    await repo.applyForwardEvent(
      ev({ kind: "PartialFill", remaining: 600_000n, cutoffMs: 2_000_000,
        payload: { filledCash: "400000", remainingCash: "600000" } }),
    );
    const t = prisma._tickets.get("0xq:0")!;
    expect(t.status).toBe("Partial");
    expect(t.remaining).toBe("600000");
    expect((t.cutoff as Date).getTime()).toBe(2_000_000);
  });

  it("Settled -> Settled, remaining 0", async () => {
    await repo.applyForwardEvent(ev({ kind: "CreateRequested" }));
    await repo.applyForwardEvent(ev({ kind: "Settled" }));
    expect(prisma._tickets.get("0xq:0")!.status).toBe("Settled");
    expect(prisma._tickets.get("0xq:0")!.remaining).toBe("0");
  });

  it("Cancelled -> Cancelled", async () => {
    await repo.applyForwardEvent(ev({ kind: "CreateRequested" }));
    await repo.applyForwardEvent(ev({ kind: "Cancelled" }));
    expect(prisma._tickets.get("0xq:0")!.status).toBe("Cancelled");
  });

  it("always appends a ForwardEvent row (idempotent on txHash+logIndex via upsert)", async () => {
    await repo.applyForwardEvent(ev({ kind: "CreateRequested" }));
    expect(prisma._events).toHaveLength(1);
    expect(prisma._events[0]!.kind).toBe("CreateRequested");
  });

  it("re-applying the same Settled event is a no-op on ticket state (idempotent)", async () => {
    await repo.applyForwardEvent(ev({ kind: "CreateRequested" }));
    await repo.applyForwardEvent(ev({ kind: "Settled", txHash: "0xs", logIndex: 2 }));
    await repo.applyForwardEvent(ev({ kind: "Settled", txHash: "0xs", logIndex: 2 }));
    const t = prisma._tickets.get("0xq:0")!;
    expect(t.status).toBe("Settled");
    expect(t.remaining).toBe("0");
  });
});
