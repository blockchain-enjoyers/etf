import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi, zeroAddress, decodeFunctionData } from "viem";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { CloneFactoryAbi } from "@meridian/contracts";
import { buildDeploy } from "./deploy.js";

const CLONE_FACTORY = "0x000000000000000000000000000000000000ff01";
const ACCOUNT = "0x0000000000000000000000000000000000000001";
const TOKEN_A = "0x000000000000000000000000000000000000aaaa";
const TOKEN_B = "0x000000000000000000000000000000000000bbbb";
const MANAGER = "0x000000000000000000000000000000000000cccc";
const KEEPER_ESCROW = "0x000000000000000000000000000000000000dddd";
const USDG = "0x000000000000000000000000000000000000feed";

const DEFAULT_SALT = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CUSTOM_SALT = "0x1111111111111111111111111111111111111111111111111111111111111111";

// Default deps: the creation-fee getters revert (pre-fee factory) → fee 0, no approve prepended.
const reverting = {
  readContract: vi.fn(async () => {
    throw new Error("revert: function does not exist");
  }),
};
const deps = { cloneFactory: CLONE_FACTORY as `0x${string}`, publicClient: reverting };

// Fee deps: readContract is routed by functionName; creationFee echoes back per-index amounts so a
// test can assert the vaultKind→enum index mapping. Tracks the spy to assert which index was read.
function makeFeeDeps(opts: { token?: string; feeByIndex?: Record<number, bigint> }) {
  const feeByIndex = opts.feeByIndex ?? {};
  const readContract = vi.fn(async (raw: unknown) => {
    const a = raw as { functionName: string; args?: unknown[] };
    if (a.functionName === "creationFeeToken") return (opts.token ?? USDG) as `0x${string}`;
    if (a.functionName === "creationFee") return feeByIndex[Number(a.args?.[0])] ?? 0n;
    throw new Error(`unexpected read ${a.functionName}`);
  });
  return { cloneFactory: CLONE_FACTORY as `0x${string}`, publicClient: { readContract } };
}

describe("buildDeploy — basket", () => {
  it("calls createBasket with flat args matching use-deploy-basket.ts:80-81", async () => {
    const req = {
      account: ACCOUNT,
      vaultKind: "basket" as const,
      name: "My Basket",
      symbol: "MYB",
      tokens: [TOKEN_A, TOKEN_B],
      unitQty: ["1000000000000000000", "2000000000000000000"],
      unitSize: "1000000000000000000",
      userSalt: CUSTOM_SALT,
    };

    const result = await buildDeploy(deps, req);

    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean; contractName: string };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(CLONE_FACTORY);
    expect(call.value).toBe("0");
    expect(call.contractName).toBe("CloneFactory");
    expect(call.needsPriorApproval).toBe(false);

    const expected = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createBasket",
      args: [
        [TOKEN_A, TOKEN_B] as `0x${string}`[],
        [1000000000000000000n, 2000000000000000000n],
        1000000000000000000n,
        "My Basket",
        "MYB",
        CUSTOM_SALT as `0x${string}`,
      ],
    });
    expect(call.data).toBe(expected);
  });

  it("uses default bytes32 zero salt when userSalt omitted", async () => {
    const req = {
      account: ACCOUNT,
      vaultKind: "basket" as const,
      name: "No Salt",
      symbol: "NSL",
      tokens: [TOKEN_A],
      unitQty: ["500000000000000000"],
      unitSize: "1000000000000000000",
    };

    const result = await buildDeploy(deps, req);
    const call = result.steps[0] as { data: string };

    const expected = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createBasket",
      args: [
        [TOKEN_A] as `0x${string}`[],
        [500000000000000000n],
        1000000000000000000n,
        "No Salt",
        "NSL",
        DEFAULT_SALT as `0x${string}`,
      ],
    });
    expect(call.data).toBe(expected);
  });

  it("emits only the factory call when the creation-fee getter reverts (pre-fee factory)", async () => {
    const req = {
      account: ACCOUNT, vaultKind: "basket" as const, name: "X", symbol: "X",
      tokens: [TOKEN_A], unitQty: ["1000000000000000000"], unitSize: "1000000000000000000",
    };
    const result = await buildDeploy(deps, req);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.kind).toBe("call");
  });
});

describe("buildDeploy — committed", () => {
  it("calls createCommittedBasket with flat args identical to basket arg shape", async () => {
    const req = {
      account: ACCOUNT,
      vaultKind: "committed" as const,
      name: "Committed Basket",
      symbol: "CMT",
      tokens: [TOKEN_A],
      unitQty: ["1000000000000000000"],
      unitSize: "1000000000000000000",
      userSalt: CUSTOM_SALT,
    };

    const result = await buildDeploy(deps, req);
    const call = result.steps[0] as { data: string; to: string };
    expect(call.to).toBe(CLONE_FACTORY);

    const expected = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createCommittedBasket",
      args: [
        [TOKEN_A] as `0x${string}`[],
        [1000000000000000000n],
        1000000000000000000n,
        "Committed Basket",
        "CMT",
        CUSTOM_SALT as `0x${string}`,
      ],
    });
    expect(call.data).toBe(expected);
  });
});

describe("buildDeploy — managed", () => {
  // use-deploy-basket.ts:38-49: struct { tokens, unitQty, unitSize, name, symbol, manager, managerFeeBps }
  it("calls createManagedBasket with ManagedBasket struct + userSalt", async () => {
    const req = {
      account: ACCOUNT,
      vaultKind: "managed" as const,
      name: "Managed Basket",
      symbol: "MGD",
      tokens: [TOKEN_A, TOKEN_B],
      unitQty: ["1000000000000000000", "3000000000000000000"],
      unitSize: "1000000000000000000",
      manager: MANAGER,
      managerFeeBps: 50,
      userSalt: CUSTOM_SALT,
    };

    const result = await buildDeploy(deps, req);
    const call = result.steps[0] as { data: string; to: string };
    expect(call.to).toBe(CLONE_FACTORY);

    const expected = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createManagedBasket",
      args: [
        {
          tokens: [TOKEN_A, TOKEN_B] as `0x${string}`[],
          unitQty: [1000000000000000000n, 3000000000000000000n],
          unitSize: 1000000000000000000n,
          name: "Managed Basket",
          symbol: "MGD",
          manager: MANAGER as `0x${string}`,
          managerFeeBps: 50,
        },
        CUSTOM_SALT as `0x${string}`,
      ],
    });
    expect(call.data).toBe(expected);
  });
});

describe("buildDeploy — rebalance", () => {
  // use-deploy-basket.ts:62-76: struct { tokens, unitQty, unitSize, name, symbol, manager, managerFeeBps, keeperBps, keeperEscrow }
  it("calls createRebalanceBasket with RebalanceBasket struct + userSalt", async () => {
    const req = {
      account: ACCOUNT,
      vaultKind: "rebalance" as const,
      name: "Rebalance Basket",
      symbol: "RBL",
      tokens: [TOKEN_A],
      unitQty: ["1000000000000000000"],
      unitSize: "1000000000000000000",
      manager: MANAGER,
      managerFeeBps: 30,
      keeperBps: 10,
      keeperEscrow: KEEPER_ESCROW,
      userSalt: CUSTOM_SALT,
    };

    const result = await buildDeploy(deps, req);
    const call = result.steps[0] as { data: string; to: string };
    expect(call.to).toBe(CLONE_FACTORY);

    const expected = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createRebalanceBasket",
      args: [
        {
          tokens: [TOKEN_A] as `0x${string}`[],
          unitQty: [1000000000000000000n],
          unitSize: 1000000000000000000n,
          name: "Rebalance Basket",
          symbol: "RBL",
          manager: MANAGER as `0x${string}`,
          managerFeeBps: 30,
          keeperBps: 10,
          keeperEscrow: KEEPER_ESCROW as `0x${string}`,
        },
        CUSTOM_SALT as `0x${string}`,
      ],
    });
    expect(call.data).toBe(expected);
  });
});

describe("buildDeploy — registry", () => {
  // Leaf encoding MUST match the contract + deploy-l5.ts: ENC=["address","uint256","uint256"],
  // leaf=[token, unitQty, unitSize], tokens sorted strictly ascending by BigInt(token), qty aligned.
  const ENC = ["address", "uint256", "uint256"];
  // TOKEN_A (0x..aaaa) < TOKEN_B (0x..bbbb) by BigInt value.

  it("calls createRegistryIndex with a genesisRoot equal to an independent StandardMerkleTree root", async () => {
    const req = {
      account: ACCOUNT,
      vaultKind: "registry" as const,
      name: "Registry Index",
      symbol: "RIX",
      tokens: [TOKEN_A, TOKEN_B],
      unitQty: ["2000000000000000000", "3000000000000000000"],
      unitSize: "1000000000000000000",
      manager: MANAGER,
      managerFeeBps: 40,
      keeperBps: 5,
      keeperEscrow: KEEPER_ESCROW,
      userSalt: CUSTOM_SALT,
    };

    const result = await buildDeploy(deps, req);
    const call = result.steps[0] as { data: string; to: string };
    expect(call.to).toBe(CLONE_FACTORY);

    // Independently recompute the root over the SORTED (token, qty, unitSize) leaves (already ascending here).
    const expectedTree = StandardMerkleTree.of(
      [
        [TOKEN_A, "2000000000000000000", "1000000000000000000"],
        [TOKEN_B, "3000000000000000000", "1000000000000000000"],
      ],
      ENC,
    );
    const expected = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createRegistryIndex",
      args: [
        {
          genesisRoot: expectedTree.root as `0x${string}`,
          tokens: [TOKEN_A, TOKEN_B] as `0x${string}`[],
          unitSize: 1000000000000000000n,
          name: "Registry Index",
          symbol: "RIX",
          manager: MANAGER as `0x${string}`,
          managerFeeBps: 40,
          keeperBps: 5,
          keeperEscrow: KEEPER_ESCROW as `0x${string}`,
        },
        CUSTOM_SALT as `0x${string}`,
      ],
    });
    expect(call.data).toBe(expected);

    // Decode the struct genesisRoot and assert it byte-for-byte equals the independent tree root.
    const { args } = decodeFunctionData({ abi: CloneFactoryAbi, data: call.data as `0x${string}` });
    const struct = (args as readonly unknown[])[0] as { genesisRoot: string; tokens: readonly string[] };
    expect(struct.genesisRoot.toLowerCase()).toBe(expectedTree.root.toLowerCase());
  });

  it("sorts tokens ascending + re-aligns unitQty when input is unordered (root matches sorted order)", async () => {
    // Deliberately reversed input: B (high) first with qty 3, A (low) second with qty 2.
    const req = {
      account: ACCOUNT,
      vaultKind: "registry" as const,
      name: "Unsorted",
      symbol: "UNS",
      tokens: [TOKEN_B, TOKEN_A],
      unitQty: ["3000000000000000000", "2000000000000000000"],
      unitSize: "1000000000000000000",
      manager: MANAGER,
      managerFeeBps: 0,
      keeperBps: 0,
      keeperEscrow: KEEPER_ESCROW,
    };

    const result = await buildDeploy(deps, req);
    const call = result.steps[0] as { data: string };

    const { args } = decodeFunctionData({ abi: CloneFactoryAbi, data: call.data as `0x${string}` });
    const struct = (args as readonly unknown[])[0] as { genesisRoot: string; tokens: readonly string[] };

    // struct.tokens must be ascending (A before B) regardless of input order.
    expect(struct.tokens.map((t) => t.toLowerCase())).toEqual([TOKEN_A, TOKEN_B]);

    // Root must be over the SORTED leaves with qty re-aligned to the sorted tokens (A→2, B→3).
    const sortedTree = StandardMerkleTree.of(
      [
        [TOKEN_A, "2000000000000000000", "1000000000000000000"],
        [TOKEN_B, "3000000000000000000", "1000000000000000000"],
      ],
      ENC,
    );
    expect(struct.genesisRoot.toLowerCase()).toBe(sortedTree.root.toLowerCase());
  });
});

describe("buildDeploy — creation fee (per-TYPE USDG)", () => {
  it("managed: prepends approve(USDG → factory, fee) as the FIRST step, then the create call", async () => {
    const FEE = 1_000_000_000_000_000_000n; // 1 USDG @ 18-dec
    const deps = makeFeeDeps({ feeByIndex: { 2: FEE } }); // MANAGED = index 2
    const req = {
      account: ACCOUNT, vaultKind: "managed" as const, name: "M", symbol: "M",
      tokens: [TOKEN_A], unitQty: ["1000000000000000000"], unitSize: "1000000000000000000",
      manager: MANAGER, managerFeeBps: 50,
    };

    const result = await buildDeploy(deps, req);

    expect(result.steps).toHaveLength(2);
    const approve = result.steps[0] as { kind: string; to: string; data: string; contractName: string };
    expect(approve.kind).toBe("approve");
    expect(approve.to).toBe(USDG);
    expect(approve.contractName).toBe("USDG");
    expect(approve.data).toBe(
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CLONE_FACTORY as `0x${string}`, FEE] }),
    );

    const call = result.steps[1] as { kind: string; to: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(CLONE_FACTORY);
    expect(call.needsPriorApproval).toBe(true);
  });

  it("reads creationFee at the vaultKind→enum index: committed=1, managed=2", async () => {
    const committedDeps = makeFeeDeps({ feeByIndex: {} });
    await buildDeploy(committedDeps, {
      account: ACCOUNT, vaultKind: "committed" as const, name: "C", symbol: "C",
      tokens: [TOKEN_A], unitQty: ["1000000000000000000"], unitSize: "1000000000000000000",
    });
    const committedRead = committedDeps.publicClient.readContract.mock.calls
      .map((c) => c[0] as { functionName: string; args?: unknown[] })
      .find((a) => a.functionName === "creationFee");
    expect(committedRead?.args?.[0]).toBe(1);

    const managedDeps = makeFeeDeps({ feeByIndex: {} });
    await buildDeploy(managedDeps, {
      account: ACCOUNT, vaultKind: "managed" as const, name: "M", symbol: "M",
      tokens: [TOKEN_A], unitQty: ["1000000000000000000"], unitSize: "1000000000000000000",
      manager: MANAGER, managerFeeBps: 50,
    });
    const managedRead = managedDeps.publicClient.readContract.mock.calls
      .map((c) => c[0] as { functionName: string; args?: unknown[] })
      .find((a) => a.functionName === "creationFee");
    expect(managedRead?.args?.[0]).toBe(2);
  });

  it("no fee approve when the per-TYPE fee is 0 (getter returns 0)", async () => {
    const deps = makeFeeDeps({ feeByIndex: { 2: 0n } });
    const result = await buildDeploy(deps, {
      account: ACCOUNT, vaultKind: "managed" as const, name: "M", symbol: "M",
      tokens: [TOKEN_A], unitQty: ["1000000000000000000"], unitSize: "1000000000000000000",
      manager: MANAGER, managerFeeBps: 50,
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.kind).toBe("call");
  });

  it("no fee approve when creationFeeToken is the zero address (even if amount > 0)", async () => {
    const deps = makeFeeDeps({ token: zeroAddress, feeByIndex: { 2: 1_000_000n } });
    const result = await buildDeploy(deps, {
      account: ACCOUNT, vaultKind: "managed" as const, name: "M", symbol: "M",
      tokens: [TOKEN_A], unitQty: ["1000000000000000000"], unitSize: "1000000000000000000",
      manager: MANAGER, managerFeeBps: 50,
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.kind).toBe("call");
  });
});
