import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../config/config.service.js";
import { IndexerRepository } from "./indexer.repository.js";
import { ChainLogReader, IndexerService } from "./indexer.service.js";
import { ForwardQueueRegistry } from "../contracts/forward-queue-registry.js";

function makeReader(): ChainLogReader {
  return {
    isReady: vi.fn(() => true),
    getHeadBlock: vi.fn(async () => 110n),
    getBasketCreated: vi.fn(async () => [
      {
        vaultAddress: "0xv",
        creator: "0xc",
        unitSize: 1_000n,
        name: "Mix",
        symbol: "mMIX",
        constituents: [
          { token: "0xA", unitQty: 10n },
          { token: "0xUSDC", unitQty: 20n },
        ],
        recipeCommitment: "0xabc",
      },
    ]),
    getManagedBasketCreated: vi.fn(async () => []),
    getCommittedBasketCreated: vi.fn(async () => []),
    getRebalanceBasketCreated: vi.fn(async () => []),
    getRegistryIndexCreated: vi.fn(async () => []),
    getVaultLifecycleLogs: vi.fn(async () => ({ rebalanced: [], targetChanges: [] })),
    getRegistryRecipeLogs: vi.fn(async () => []),
    readRegistryGenesis: vi.fn(async () => []),
    getKeeperPayoutLogs: vi.fn(async () => []),
    getForwardQueueLogs: vi.fn(async () => []),
    getVaultActivityLogs: vi.fn(async () => []),
  } as unknown as ChainLogReader;
}

function makeRepo() {
  return {
    applyBasketCreated: vi.fn().mockResolvedValue(undefined),
    applyManagedBasketCreated: vi.fn().mockResolvedValue(undefined),
    applyCommittedBasketCreated: vi.fn().mockResolvedValue(undefined),
    applyRebalanceBasketCreated: vi.fn().mockResolvedValue(undefined),
    applyRegistryIndexCreated: vi.fn().mockResolvedValue(undefined),
    applyRebalanced: vi.fn().mockResolvedValue(undefined),
    applyTargetChange: vi.fn().mockResolvedValue(undefined),
    applyKeeperPayout: vi.fn().mockResolvedValue(undefined),
    applyActivityEvent: vi.fn().mockResolvedValue(undefined),
    replaceRegistryConstituents: vi.fn().mockResolvedValue(undefined),
    getRebalanceVaultAddresses: vi.fn(async () => [] as string[]),
    getRegistryVaultAddresses: vi.fn(async () => [] as string[]),
    getAllVaultAddresses: vi.fn(async () => [] as string[]),
    getRegistryVaultsNeedingGenesis: vi.fn(async () => [] as string[]),
    getGenesisConstituents: vi.fn(async () => [] as { token: string; unitQty: bigint }[]),
    getLiveForwardQueues: vi.fn(async () => [] as { vault: string; queue: string }[]),
    getCheckpoint: vi.fn(async () => 100n),
    setCheckpoint: vi.fn(async () => {}),
  };
}

describe("IndexerService", () => {
  let service: IndexerService;
  let reader: ChainLogReader;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    reader = makeReader();
    repo = makeRepo();
    const moduleRef = await Test.createTestingModule({
      providers: [
        IndexerService,
        { provide: ConfigService, useValue: { get: (k: string) => (k === "CHAIN_ID" ? 46630 : "") } },
        { provide: IndexerRepository, useValue: repo },
        { provide: ChainLogReader, useValue: reader },
        { provide: ForwardQueueRegistry, useValue: { pairs: () => [], queueFor: () => undefined, refresh: vi.fn(async () => {}) } },
      ],
    }).compile();
    service = moduleRef.get(IndexerService);
  });

  it("projects BasketCreated logs from the checkpoint to head and advances the checkpoint", async () => {
    const processed = await service.tick();
    expect(repo.applyBasketCreated).toHaveBeenCalledOnce();
    const arg = repo.applyBasketCreated.mock.calls[0]![0] as {
      vaultAddress: string;
      constituents: unknown[];
    };
    expect(arg.vaultAddress).toBe("0xv");
    expect(arg.constituents).toHaveLength(2);
    expect(repo.setCheckpoint).toHaveBeenCalledWith(46630, 110n);
    expect(processed).toBe(1);
  });

  it("is a no-op when already at head", async () => {
    (reader.getHeadBlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(100n);
    const processed = await service.tick();
    expect(processed).toBe(0);
    expect(repo.setCheckpoint).not.toHaveBeenCalled();
  });

  it("skips without advancing the checkpoint when the factory is not configured", async () => {
    (reader.isReady as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const processed = await service.tick();
    expect(processed).toBe(0);
    expect(repo.setCheckpoint).not.toHaveBeenCalled();
  });

  it("indexes a RebalanceBasketCreated event into a Rebalance basket", async () => {
    reader.getRebalanceBasketCreated = vi.fn(async () => [
      {
        vaultAddress: "0xreb",
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
      },
    ]);
    const applyRebalance = vi.spyOn(repo, "applyRebalanceBasketCreated");
    await service.tick();
    expect(applyRebalance).toHaveBeenCalledTimes(1);
  });

  it("indexes a RegistryIndexCreated event into a Registry basket (empty constituents)", async () => {
    reader.getRegistryIndexCreated = vi.fn(async () => [
      {
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
      },
    ]);
    const applyRegistry = vi.spyOn(repo, "applyRegistryIndexCreated");
    await service.tick();
    expect(applyRegistry).toHaveBeenCalledTimes(1);
    expect(applyRegistry.mock.calls[0]![0]!.constituents).toHaveLength(0);
  });

  it("scans vault lifecycle + keeper payouts for known rebalance vaults", async () => {
    vi.spyOn(repo, "getRebalanceVaultAddresses").mockResolvedValue(["0xreb"]);
    reader.getVaultLifecycleLogs = vi.fn(async () => ({
      rebalanced: [
        {
          vaultAddress: "0xreb",
          txHash: "0xh",
          logIndex: 0,
          blockNumber: 10n,
          recipient: "0xr",
          acquire: ["0xa"],
          acquireIn: ["1"],
          release: ["0xb"],
          releaseOut: ["2"],
          timestampMs: 1000,
        },
      ],
      targetChanges: [],
    }));
    reader.getKeeperPayoutLogs = vi.fn(async () => []);
    const applyReb = vi.spyOn(repo, "applyRebalanced");
    await service.tick();
    expect(reader.getVaultLifecycleLogs).toHaveBeenCalledWith(
      ["0xreb"],
      expect.anything(),
      expect.anything(),
    );
    expect(applyReb).toHaveBeenCalledTimes(1);
  });

  it("writes a registry vault's constituents from a RootScheduled recipe log", async () => {
    vi.spyOn(repo, "getRegistryVaultAddresses").mockResolvedValue(["0xReg"]);
    reader.getRegistryRecipeLogs = vi.fn(async () => [
      {
        vaultAddress: "0xReg",
        constituents: [
          { token: "0xA", unitQty: 11n },
          { token: "0xB", unitQty: 22n },
        ],
      },
    ]);
    const replace = vi.spyOn(repo, "replaceRegistryConstituents");
    await service.tick();
    expect(reader.getRegistryRecipeLogs).toHaveBeenCalledWith(
      ["0xReg"],
      expect.anything(),
      expect.anything(),
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]![0]).toEqual({
      vaultAddress: "0xReg",
      constituents: [
        { token: "0xA", unitQty: 11n },
        { token: "0xB", unitQty: 22n },
      ],
    });
  });

  it("populates genesis constituents from heldTokens/holdingsOf once a registry vault is bootstrapped", async () => {
    vi.spyOn(repo, "getRegistryVaultsNeedingGenesis").mockResolvedValue(["0xReg"]);
    reader.readRegistryGenesis = vi.fn(async () => [
      { token: "0xA", unitQty: 100n },
      { token: "0xB", unitQty: 200n },
    ]);
    const replace = vi.spyOn(repo, "replaceRegistryConstituents");
    await service.tick();
    expect(reader.readRegistryGenesis).toHaveBeenCalledWith("0xReg");
    expect(replace).toHaveBeenCalledWith({
      vaultAddress: "0xReg",
      constituents: [
        { token: "0xA", unitQty: 100n },
        { token: "0xB", unitQty: 200n },
      ],
    });
  });

  it("prefers the persisted genesis recipe over the on-chain read (populates pre-bootstrap)", async () => {
    vi.spyOn(repo, "getRegistryVaultsNeedingGenesis").mockResolvedValue(["0xReg"]);
    vi.spyOn(repo, "getGenesisConstituents").mockResolvedValue([
      { token: "0xA", unitQty: 500n },
      { token: "0xB", unitQty: 300n },
    ]);
    reader.readRegistryGenesis = vi.fn(async () => []);
    const replace = vi.spyOn(repo, "replaceRegistryConstituents");
    await service.tick();
    // Recipe satisfied the set → the on-chain post-bootstrap read is never reached.
    expect(reader.readRegistryGenesis).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith({
      vaultAddress: "0xReg",
      constituents: [
        { token: "0xA", unitQty: 500n },
        { token: "0xB", unitQty: 300n },
      ],
    });
  });

  it("does NOT write constituents when a registry vault's genesis read is empty (unbootstrapped/reverting)", async () => {
    vi.spyOn(repo, "getRegistryVaultsNeedingGenesis").mockResolvedValue(["0xReg"]);
    reader.readRegistryGenesis = vi.fn(async () => []);
    const replace = vi.spyOn(repo, "replaceRegistryConstituents");
    await service.tick();
    expect(reader.readRegistryGenesis).toHaveBeenCalledWith("0xReg");
    expect(replace).not.toHaveBeenCalled();
  });
});

it("routes managed + committed creation events to the repository", async () => {
  const repo = {
    getCheckpoint: vi.fn().mockResolvedValue(0n),
    setCheckpoint: vi.fn().mockResolvedValue(undefined),
    applyBasketCreated: vi.fn().mockResolvedValue(undefined),
    applyManagedBasketCreated: vi.fn().mockResolvedValue(undefined),
    applyCommittedBasketCreated: vi.fn().mockResolvedValue(undefined),
    applyRebalanceBasketCreated: vi.fn().mockResolvedValue(undefined),
    applyRegistryIndexCreated: vi.fn().mockResolvedValue(undefined),
    applyActivityEvent: vi.fn().mockResolvedValue(undefined),
    replaceRegistryConstituents: vi.fn().mockResolvedValue(undefined),
    getRebalanceVaultAddresses: vi.fn().mockResolvedValue([]),
    getRegistryVaultAddresses: vi.fn().mockResolvedValue([]),
    getAllVaultAddresses: vi.fn().mockResolvedValue([]),
    getRegistryVaultsNeedingGenesis: vi.fn().mockResolvedValue([]),
    getLiveForwardQueues: vi.fn().mockResolvedValue([]),
  };
  const reader = {
    isReady: () => true,
    getHeadBlock: vi.fn().mockResolvedValue(10n),
    getBasketCreated: vi.fn().mockResolvedValue([]),
    getManagedBasketCreated: vi.fn().mockResolvedValue([
      { vaultAddress: "0xm", creator: "0xc", manager: "0xmgr", managerFeeBps: 50, platformFeeBps: 15,
        unitSize: 1n, name: "M", symbol: "M", constituents: [], recipeCommitment: "0x1" },
    ]),
    getCommittedBasketCreated: vi.fn().mockResolvedValue([
      { vaultAddress: "0xk", creator: "0xc", unitSize: 1n, name: "K", symbol: "K",
        constituents: [], recipeCommitment: "0x2" },
    ]),
    getRebalanceBasketCreated: vi.fn().mockResolvedValue([]),
    getRegistryIndexCreated: vi.fn().mockResolvedValue([]),
    getVaultLifecycleLogs: vi.fn().mockResolvedValue({ rebalanced: [], targetChanges: [] }),
    getRegistryRecipeLogs: vi.fn().mockResolvedValue([]),
    readRegistryGenesis: vi.fn().mockResolvedValue([]),
    getKeeperPayoutLogs: vi.fn().mockResolvedValue([]),
    getForwardQueueLogs: vi.fn().mockResolvedValue([]),
    getVaultActivityLogs: vi.fn().mockResolvedValue([]),
  };
  const config = { get: () => 46630 } as unknown as ConstructorParameters<typeof IndexerService>[0];
  const forwardQueues = { pairs: () => [], queueFor: () => undefined, refresh: vi.fn(async () => {}) };
  const svc = new IndexerService(config, repo as never, reader as never, forwardQueues as never);
  await svc.tick();
  expect(repo.applyManagedBasketCreated).toHaveBeenCalledOnce();
  expect(repo.applyCommittedBasketCreated).toHaveBeenCalledOnce();
});

it("indexes forward-queue logs with the Basket's stored (checksummed) vault, not the registry's lowercased key", async () => {
  const CHECKSUM = "0x7C4627158652a6950A091Cbf126d744F4E6BCa9E";
  const QUEUE = "0x4103bc6ad1d45a5589dc9347380db0a228eb2db7";
  const repo = makeRepo() as ReturnType<typeof makeRepo> & { applyForwardEvent: ReturnType<typeof vi.fn> };
  repo.getAllVaultAddresses = vi.fn(async () => [CHECKSUM]);
  repo.applyForwardEvent = vi.fn(async () => undefined);
  const reader = makeReader();
  reader.getForwardQueueLogs = vi.fn(async () => [{ vaultAddress: CHECKSUM }]) as never;
  const config = { get: (k: string) => (k === "CHAIN_ID" ? 46630 : "") } as unknown as ConstructorParameters<typeof IndexerService>[0];
  // Registry lowercases its keys → pairs() yields the lowercased vault.
  const forwardQueues = {
    pairs: () => [{ vault: CHECKSUM.toLowerCase(), queue: QUEUE }],
    queueFor: () => QUEUE,
    refresh: vi.fn(async () => {}),
  };
  const svc = new IndexerService(config, repo as never, reader as never, forwardQueues as never);
  await svc.tick();
  // The reader must be called with the checksummed Basket address so the ForwardTicket FK resolves.
  expect(reader.getForwardQueueLogs).toHaveBeenCalledWith(QUEUE, CHECKSUM, expect.anything(), expect.anything());
  expect(repo.applyForwardEvent).toHaveBeenCalledWith({ vaultAddress: CHECKSUM });
});
