import { encodeFunctionData } from "viem";
import { CloneFactoryAbi } from "@meridian/contracts";
import type { ActionResult, BuiltStep } from "../action-registry.js";

const DEFAULT_SALT = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface DeployDeps {
  cloneFactory: `0x${string}`;
}

export interface DeployTxRequest {
  account: string;
  vaultKind: "basket" | "managed" | "committed" | "rebalance";
  name: string;
  symbol: string;
  tokens: string[];
  unitQty: string[];
  unitSize: string;
  manager?: string;
  managerFeeBps?: number;
  keeperBps?: number;
  keeperEscrow?: string;
  userSalt?: string;
}

export async function buildDeploy(deps: DeployDeps, req: DeployTxRequest): Promise<ActionResult> {
  const tokens = req.tokens as `0x${string}`[];
  const unitQty = req.unitQty.map((q) => BigInt(q));
  const unitSize = BigInt(req.unitSize);
  const userSalt = (req.userSalt ?? DEFAULT_SALT) as `0x${string}`;

  let data: `0x${string}`;

  if (req.vaultKind === "managed") {
    // use-deploy-basket.ts:38-49: createManagedBasket({tokens, unitQty, unitSize, name, symbol, manager, managerFeeBps}, userSalt)
    data = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createManagedBasket",
      args: [
        {
          tokens,
          unitQty,
          unitSize,
          name: req.name,
          symbol: req.symbol,
          manager: req.manager! as `0x${string}`,
          managerFeeBps: req.managerFeeBps! as number,
        },
        userSalt,
      ],
    });
  } else if (req.vaultKind === "committed") {
    // use-deploy-basket.ts:55: createCommittedBasket(tokens, unitQty, unitSize, name, symbol, userSalt)
    data = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createCommittedBasket",
      args: [tokens, unitQty, unitSize, req.name, req.symbol, userSalt],
    });
  } else if (req.vaultKind === "rebalance") {
    // use-deploy-basket.ts:62-76: createRebalanceBasket({tokens, unitQty, unitSize, name, symbol, manager, managerFeeBps, keeperBps, keeperEscrow}, userSalt)
    data = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createRebalanceBasket",
      args: [
        {
          tokens,
          unitQty,
          unitSize,
          name: req.name,
          symbol: req.symbol,
          manager: req.manager! as `0x${string}`,
          managerFeeBps: req.managerFeeBps! as number,
          keeperBps: req.keeperBps! as number,
          keeperEscrow: req.keeperEscrow! as `0x${string}`,
        },
        userSalt,
      ],
    });
  } else {
    // basket: use-deploy-basket.ts:80-81: createBasket(tokens, unitQty, unitSize, name, symbol, userSalt)
    data = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createBasket",
      args: [tokens, unitQty, unitSize, req.name, req.symbol, userSalt],
    });
  }

  const call: BuiltStep = {
    kind: "call",
    to: deps.cloneFactory,
    data,
    value: "0",
    contractName: "CloneFactory",
    label: `Deploy ${req.vaultKind} basket "${req.name}"`,
    summary: `Create a new ${req.vaultKind} vault via CloneFactory for ${req.symbol}`,
    needsPriorApproval: false,
  };

  return { steps: [call], finalize: null };
}
