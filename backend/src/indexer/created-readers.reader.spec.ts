import { describe, it, expect, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiItem } from "viem";
import { ViemChainLogReader } from "./indexer.service.js";

/**
 * Unit-tests the real ViemChainLogReader managed/rebalance created-readers, focusing on the
 * resilient platformFeeBps() read: it is surfaced when the getter resolves, and yields null
 * (without throwing) when the on-chain getter REVERTS (currently-deployed impls predate it).
 */

const MANAGED_EVENT = parseAbiItem(
  "event ManagedBasketCreated(address indexed vault, address indexed creator, address manager, uint16 managerFeeBps)",
);
const REBALANCE_EVENT = parseAbiItem(
  "event RebalanceBasketCreated(address indexed vault, address indexed creator, address manager)",
);

const VAULT = "0x000000000000000000000000000000000000000a" as const;

function managedLog(manager: string, managerFeeBps: number) {
  const topics = encodeEventTopics({
    abi: [MANAGED_EVENT],
    eventName: "ManagedBasketCreated",
    args: { vault: VAULT, creator: "0x000000000000000000000000000000000000000b" },
  });
  const data = encodeAbiParameters(
    [{ type: "address" }, { type: "uint16" }],
    [manager as `0x${string}`, managerFeeBps],
  );
  return { topics, data, transactionHash: "0xh", logIndex: 0, blockNumber: 1n };
}

function rebalanceLog(manager: string) {
  const topics = encodeEventTopics({
    abi: [REBALANCE_EVENT],
    eventName: "RebalanceBasketCreated",
    args: { vault: VAULT, creator: "0x000000000000000000000000000000000000000b" },
  });
  const data = encodeAbiParameters([{ type: "address" }], [manager as `0x${string}`]);
  return { topics, data, transactionHash: "0xh", logIndex: 0, blockNumber: 1n };
}

/** platformFeeBps resolves to `fee` (number) or rejects (revert) when `fee === "revert"`. */
function makeReader(log: unknown, fee: number | "revert") {
  const publicClient = {
    getLogs: vi.fn(() => Promise.resolve([log])),
    readContract: vi.fn(({ functionName }: { functionName: string }) => {
      if (functionName === "platformFeeBps") {
        return fee === "revert"
          ? Promise.reject(new Error("execution reverted: function does not exist"))
          : Promise.resolve(fee);
      }
      return Promise.resolve(0n);
    }),
  };
  const chain = { publicClient } as never;
  const factory = {
    address: "0xfactory",
    abi: [MANAGED_EVENT, REBALANCE_EVENT],
    managedBasketCreatedEvent: MANAGED_EVENT,
    rebalanceBasketCreatedEvent: REBALANCE_EVENT,
  } as never;
  const vault = {
    getConstituents: vi.fn(async () => [
      { token: "0x000000000000000000000000000000000000000d", unitQty: 1n },
    ]),
    unitSize: vi.fn(async () => 1000n),
    name: vi.fn(async () => "N"),
    symbol: vi.fn(async () => "S"),
  } as never;
  const rebVault = {
    managerFeeBps: vi.fn(async () => 50),
    keeperBps: vi.fn(async () => 1000),
    keeperEscrow: vi.fn(async () => "0xk"),
  } as never;
  return new ViemChainLogReader(chain, factory, vault, rebVault, {} as never, {} as never, {} as never);
}

describe("ViemChainLogReader.getManagedBasketCreated platformFeeBps", () => {
  it("surfaces platformFeeBps when the getter resolves", async () => {
    const reader = makeReader(managedLog("0x000000000000000000000000000000000000000c", 100), 15);
    const out = await reader.getManagedBasketCreated(0n, 10n);
    expect(out).toHaveLength(1);
    expect(out[0]!.managerFeeBps).toBe(100);
    expect(out[0]!.platformFeeBps).toBe(15);
  });

  it("yields platformFeeBps=null and does NOT throw when the getter reverts", async () => {
    const reader = makeReader(managedLog("0x000000000000000000000000000000000000000c", 100), "revert");
    const out = await reader.getManagedBasketCreated(0n, 10n);
    expect(out).toHaveLength(1);
    expect(out[0]!.platformFeeBps).toBeNull();
  });
});

const REGISTRY_EVENT = parseAbiItem(
  "event RegistryIndexCreated(address indexed vault, address indexed creator, address indexed manager, bytes32 userSalt)",
);

function registryLog(manager: string) {
  const topics = encodeEventTopics({
    abi: [REGISTRY_EVENT],
    eventName: "RegistryIndexCreated",
    args: {
      vault: VAULT,
      creator: "0x000000000000000000000000000000000000000b",
      manager: manager as `0x${string}`,
    },
  });
  const data = encodeAbiParameters(
    [{ type: "bytes32" }],
    ["0x0000000000000000000000000000000000000000000000000000000000000001"],
  );
  return { topics, data, transactionHash: "0xh", logIndex: 0, blockNumber: 1n };
}

/**
 * Registry reader: every vault getter is read resiliently. `recipeRoot` is forced to revert here to
 * prove a single reverting read yields a null/default fallback (NOT a throw that would freeze the tick).
 */
function makeRegistryReader(log: unknown, recipeRoot: string | "revert") {
  const publicClient = {
    getLogs: vi.fn(() => Promise.resolve([log])),
    readContract: vi.fn(({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "recipeRoot":
          return recipeRoot === "revert"
            ? Promise.reject(new Error("execution reverted"))
            : Promise.resolve(recipeRoot);
        case "name": return Promise.resolve("SP500");
        case "symbol": return Promise.resolve("SP5");
        case "unitSize": return Promise.resolve(1000n);
        case "managerFeeBps": return Promise.resolve(50);
        case "keeperBps": return Promise.resolve(1000);
        case "keeperEscrow": return Promise.resolve("0x000000000000000000000000000000000000000e");
        case "platformFeeBps": return Promise.resolve(15);
        default: return Promise.resolve(0n);
      }
    }),
  };
  const chain = { publicClient } as never;
  const factory = {
    address: "0xfactory",
    abi: [REGISTRY_EVENT],
    registryIndexCreatedEvent: REGISTRY_EVENT,
  } as never;
  return new ViemChainLogReader(chain, factory, {} as never, {} as never, {} as never, {} as never, {} as never);
}

describe("ViemChainLogReader.getRegistryIndexCreated", () => {
  it("maps manager from the event + resilient vault reads, with EMPTY constituents", async () => {
    const reader = makeRegistryReader(
      registryLog("0x000000000000000000000000000000000000000c"),
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
    );
    const out = await reader.getRegistryIndexCreated(0n, 10n);
    expect(out).toHaveLength(1);
    expect(out[0]!.manager).toBe("0x000000000000000000000000000000000000000C");
    expect(out[0]!.name).toBe("SP500");
    expect(out[0]!.keeperBps).toBe(1000);
    expect(out[0]!.platformFeeBps).toBe(15);
    expect(out[0]!.constituents).toHaveLength(0);
    expect(out[0]!.recipeCommitment).toBe(
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
    );
  });

  it("falls back to the zero recipeRoot (and does NOT throw) when a read reverts", async () => {
    const reader = makeRegistryReader(
      registryLog("0x000000000000000000000000000000000000000c"),
      "revert",
    );
    const out = await reader.getRegistryIndexCreated(0n, 10n);
    expect(out).toHaveLength(1);
    expect(out[0]!.recipeCommitment).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    );
  });
});

const ROOT_SCHEDULED_EVENT = parseAbiItem(
  "event RootScheduled(bytes32 indexed newRoot, uint64 effectiveAt, address[] tokens, uint256[] unitQty, uint256 unitSize)",
);
const REG_VAULT = "0x000000000000000000000000000000000000000A" as const;
const TOKEN_A = "0x000000000000000000000000000000000000000a" as const;
const TOKEN_B = "0x000000000000000000000000000000000000000b" as const;

function rootScheduledLog(
  tokens: readonly string[],
  unitQty: readonly bigint[],
  over: { blockNumber?: bigint; logIndex?: number; address?: string } = {},
) {
  const topics = encodeEventTopics({
    abi: [ROOT_SCHEDULED_EVENT],
    eventName: "RootScheduled",
    args: { newRoot: "0x00000000000000000000000000000000000000000000000000000000000000aa" },
  });
  const data = encodeAbiParameters(
    [{ type: "uint64" }, { type: "address[]" }, { type: "uint256[]" }, { type: "uint256" }],
    [1_000n, tokens as `0x${string}`[], [...unitQty], 1_000n],
  );
  return {
    address: over.address ?? REG_VAULT.toLowerCase(),
    topics,
    data,
    transactionHash: "0xh",
    logIndex: over.logIndex ?? 0,
    blockNumber: over.blockNumber ?? 1n,
  };
}

function makeRecipeReader(logs: unknown[]) {
  const publicClient = { getLogs: vi.fn(() => Promise.resolve(logs)) };
  const chain = { publicClient } as never;
  return new ViemChainLogReader(chain, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
}

describe("ViemChainLogReader.getRegistryRecipeLogs", () => {
  it("maps a RootScheduled recipe into a constituent update keyed by the checksummed Basket address", async () => {
    const reader = makeRecipeReader([rootScheduledLog([TOKEN_A, TOKEN_B], [11n, 22n])]);
    const out = await reader.getRegistryRecipeLogs([REG_VAULT], 0n, 10n);
    expect(out).toHaveLength(1);
    // Address-cased back to the passed (checksummed) Basket address, not the lowercase log.address.
    expect(out[0]!.vaultAddress).toBe(REG_VAULT);
    // viem's event decode checksums the address[] — constituents carry checksummed tokens (consistent
    // with getBasketCreated, which also maps decoded `tokens` straight through).
    expect(out[0]!.constituents).toEqual([
      { token: getAddress(TOKEN_A), unitQty: 11n },
      { token: getAddress(TOKEN_B), unitQty: 22n },
    ]);
  });

  it("keeps the LATEST recipe when a vault schedules twice in one range (last-write-wins)", async () => {
    const reader = makeRecipeReader([
      rootScheduledLog([TOKEN_A, TOKEN_B], [1n, 2n], { blockNumber: 5n, logIndex: 0 }),
      rootScheduledLog([TOKEN_A], [9n], { blockNumber: 6n, logIndex: 0 }), // newer: drops 0xB
    ]);
    const out = await reader.getRegistryRecipeLogs([REG_VAULT], 0n, 10n);
    expect(out).toHaveLength(1);
    expect(out[0]!.constituents).toEqual([{ token: getAddress(TOKEN_A), unitQty: 9n }]);
  });

  it("ignores RootScheduled logs from addresses not in the registry set", async () => {
    const reader = makeRecipeReader([
      rootScheduledLog([TOKEN_A], [1n], { address: "0x00000000000000000000000000000000000000ff" }),
    ]);
    const out = await reader.getRegistryRecipeLogs([REG_VAULT], 0n, 10n);
    expect(out).toHaveLength(0);
  });

  it("returns [] without calling getLogs when there are no registry vaults", async () => {
    const reader = makeRecipeReader([]);
    const out = await reader.getRegistryRecipeLogs([], 0n, 10n);
    expect(out).toHaveLength(0);
  });
});

/** heldTokens resolves to `held`; holdingsOf returns its index+1 *100, or reverts per `revertOn`. */
function makeGenesisReader(held: readonly string[] | "revert", revertOn: Set<string> = new Set()) {
  const publicClient = {
    readContract: vi.fn(({ functionName }: { functionName: string }) => {
      if (functionName === "heldTokens") {
        return held === "revert"
          ? Promise.reject(new Error("execution reverted"))
          : Promise.resolve(held);
      }
      return Promise.resolve(0n);
    }),
    multicall: vi.fn(({ contracts }: { contracts: { args: readonly unknown[] }[] }) =>
      Promise.resolve(
        contracts.map((c) => {
          const token = c.args[0] as string;
          return revertOn.has(token)
            ? { status: "failure" as const, error: new Error("revert") }
            : { status: "success" as const, result: BigInt((held as string[]).indexOf(token) + 1) * 100n };
        }),
      ),
    ),
  };
  const chain = { publicClient } as never;
  return new ViemChainLogReader(chain, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
}

describe("ViemChainLogReader.readRegistryGenesis", () => {
  it("reads heldTokens + holdingsOf into a constituent set", async () => {
    const reader = makeGenesisReader([TOKEN_A, TOKEN_B]);
    const out = await reader.readRegistryGenesis(REG_VAULT);
    expect(out).toEqual([
      { token: TOKEN_A, unitQty: 100n },
      { token: TOKEN_B, unitQty: 200n },
    ]);
  });

  it("returns [] (does NOT throw) when heldTokens reverts (unbootstrapped / pre-seam impl)", async () => {
    const reader = makeGenesisReader("revert");
    await expect(reader.readRegistryGenesis(REG_VAULT)).resolves.toEqual([]);
  });

  it("returns [] when the vault is bootstrapped but holds nothing", async () => {
    const reader = makeGenesisReader([]);
    await expect(reader.readRegistryGenesis(REG_VAULT)).resolves.toEqual([]);
  });

  it("drops a single token whose holdingsOf read failed, keeping the rest", async () => {
    const reader = makeGenesisReader([TOKEN_A, TOKEN_B], new Set([TOKEN_B]));
    const out = await reader.readRegistryGenesis(REG_VAULT);
    expect(out).toEqual([{ token: TOKEN_A, unitQty: 100n }]);
  });
});

describe("ViemChainLogReader.getRebalanceBasketCreated platformFeeBps", () => {
  it("surfaces platformFeeBps when the getter resolves", async () => {
    const reader = makeReader(rebalanceLog("0x000000000000000000000000000000000000000c"), 15);
    const out = await reader.getRebalanceBasketCreated(0n, 10n);
    expect(out).toHaveLength(1);
    expect(out[0]!.keeperBps).toBe(1000);
    expect(out[0]!.platformFeeBps).toBe(15);
  });

  it("yields platformFeeBps=null and does NOT throw when the getter reverts", async () => {
    const reader = makeReader(rebalanceLog("0x000000000000000000000000000000000000000c"), "revert");
    const out = await reader.getRebalanceBasketCreated(0n, 10n);
    expect(out).toHaveLength(1);
    expect(out[0]!.platformFeeBps).toBeNull();
  });
});
