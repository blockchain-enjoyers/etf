import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { CloneFactoryAbi } from "@meridian/contracts";
import { buildDeploy } from "./deploy.js";

const CLONE_FACTORY = "0x000000000000000000000000000000000000ff01";
const ACCOUNT = "0x0000000000000000000000000000000000000001";
const TOKEN_A = "0x000000000000000000000000000000000000aaaa";
const TOKEN_B = "0x000000000000000000000000000000000000bbbb";
const MANAGER = "0x000000000000000000000000000000000000cccc";
const KEEPER_ESCROW = "0x000000000000000000000000000000000000dddd";

const DEFAULT_SALT = "0x0000000000000000000000000000000000000000000000000000000000000000";
const CUSTOM_SALT = "0x1111111111111111111111111111111111111111111111111111111111111111";

const deps = { cloneFactory: CLONE_FACTORY as `0x${string}` };

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
