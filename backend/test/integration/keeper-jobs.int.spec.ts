import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChainService } from "../../src/chain/chain.service.js";
import { CapabilityUnavailableError } from "../../src/capabilities/capability-unavailable.error.js";
import type { SettleWriterPort } from "../../src/capabilities/settle-writer.port.js";
import { ConfigModule } from "../../src/config/config.module.js";
import { SettleService } from "../../src/keeper/settle.service.js";
import { PersistenceModule } from "../../src/persistence/persistence.module.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";

const wallet = { account: { address: "0xKEEPER" as `0x${string}` }, writeContract: vi.fn(async () => "0xtx" as `0x${string}`) };
const fakeChain = { walletClient: wallet, account: wallet.account, chain: { id: 46630 } } as unknown as ChainService;

function liveWriter(): SettleWriterPort {
  return { settle: vi.fn(async () => "0xtx" as `0x${string}`) } as unknown as SettleWriterPort;
}

function _nullWriter(): SettleWriterPort {
  return {
    settle: vi.fn(async () => {
      throw new CapabilityUnavailableError("RebalanceModule");
    }),
  } as unknown as SettleWriterPort;
}

const VAULT = "0x000000000000000000000000000000000000cafe";

describe("Keeper settle (integration)", () => {
  let prisma: PrismaService;
  let svc: SettleService;
  let writer: SettleWriterPort;
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;

  beforeAll(async () => {
    process.env.KEEPER_ENABLED = "true";
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PersistenceModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    const { ConfigService: CS } = await import("../../src/config/config.service.js");
    const config = moduleRef.get(CS);
    writer = liveWriter();
    svc = new SettleService(fakeChain, writer, prisma, config);

    await prisma.basket.create({
      data: {
        vaultAddress: VAULT,
        unitSize: "100",
        name: "Queue Basket",
        symbol: "mQ",
      },
    });
    await prisma.queueEntry.createMany({
      data: [
        { vaultAddress: VAULT, owner: "0xa", basketTokenAmount: "10", nonce: 1n, submittedAt: new Date(), status: "Pending" },
        { vaultAddress: VAULT, owner: "0xb", basketTokenAmount: "20", nonce: 2n, submittedAt: new Date(), status: "Pending" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.onApplicationShutdown();
    await moduleRef.close();
  });

  it("settles all pending entries and records tx hashes", async () => {
    const res = await svc.run({ vaultAddress: VAULT });
    expect(res.status).toBe("submitted");
    const rows = await prisma.queueEntry.findMany({ where: { vaultAddress: VAULT } });
    expect(rows.every((r) => r.status === "Settled")).toBe(true);
    expect(rows.every((r) => r.settledTxHash === "0xtx")).toBe(true);
    expect((writer.settle as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("is idempotent: a second pass is a no-op (no pending rows left)", async () => {
    (writer.settle as ReturnType<typeof vi.fn>).mockClear();
    const res = await svc.run({ vaultAddress: VAULT });
    expect(res.status).toBe("skipped");
    expect(writer.settle).not.toHaveBeenCalled();
  });

  it("the unique (vaultAddress, nonce) constraint blocks a duplicate forward-queue entry", async () => {
    await expect(
      prisma.queueEntry.create({
        data: { vaultAddress: VAULT, owner: "0xc", basketTokenAmount: "5", nonce: 1n, submittedAt: new Date() },
      }),
    ).rejects.toThrow();
  });
});
