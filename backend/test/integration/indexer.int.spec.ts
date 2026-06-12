import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigModule } from "../../src/config/config.module.js";
import { PersistenceModule } from "../../src/persistence/persistence.module.js";
import { PrismaService } from "../../src/persistence/prisma.service.js";
import { IndexerRepository } from "../../src/indexer/indexer.repository.js";
import { ChainLogReader, IndexerService } from "../../src/indexer/indexer.service.js";

const fakeReader: ChainLogReader = {
  isReady: () => true,
  getHeadBlock: async () => 50n,
  getBasketCreated: async () => [
    {
      vaultAddress: "0xvault_idx",
      creator: "0xcreator",
      unitSize: 1_000n,
      name: "Indexed",
      symbol: "mIDX",
      constituents: [
        { token: "0xA", unitQty: 10n },
        { token: "0xUSDC", unitQty: 20n },
      ],
    },
  ],
  getManagedBasketCreated: async () => [],
  getCommittedBasketCreated: async () => [],
  getRebalanceBasketCreated: async () => [],
  getRegistryIndexCreated: async () => [],
  getVaultLifecycleLogs: async () => ({ rebalanced: [], targetChanges: [] }),
  getRegistryRecipeLogs: async () => [],
  readRegistryGenesis: async () => [],
  getKeeperPayoutLogs: async () => [],
  getForwardQueueLogs: async () => [],
};

describe("IndexerService (integration)", () => {
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;
  let prisma: PrismaService;
  let indexer: IndexerService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PersistenceModule],
      providers: [
        IndexerRepository,
        IndexerService,
        { provide: ChainLogReader, useValue: fakeReader },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    indexer = moduleRef.get(IndexerService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onApplicationShutdown();
    await moduleRef.close();
  });

  it("persists basket and constituents, then advances the checkpoint", async () => {
    const processed = await indexer.tick();
    expect(processed).toBe(1);

    const basket = await prisma.basket.findUnique({
      where: { vaultAddress: "0xvault_idx" },
      include: { constituents: true },
    });
    expect(basket?.symbol).toBe("mIDX");
    expect(basket?.constituents).toHaveLength(2);
    const usdc = basket?.constituents.find((c) => c.token === "0xUSDC");
    expect(usdc?.unitQty.toString()).toBe("20");

    const checkpoint = await prisma.indexerCheckpoint.findUnique({ where: { chainId: 46630 } });
    expect(checkpoint?.lastProcessedBlock).toBe(50n);

    // Idempotency: a second tick from the same fake head is a no-op.
    expect(await indexer.tick()).toBe(0);
  });
});
