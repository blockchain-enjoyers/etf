import { encodeFunctionData, erc20Abi, zeroAddress } from "viem";
import { CloneFactoryAbi } from "@meridian/contracts";
import type { ActionResult, BuiltStep } from "../action-registry.js";
import { buildGenesisRoot } from "../registry-recipe.js";

const DEFAULT_SALT = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface DeployDeps {
  cloneFactory: `0x${string}`;
  publicClient: { readContract: (args: unknown) => Promise<unknown> };
}

// CloneFactory.VaultType enum index per vaultKind (NOT alphabetical):
// BASKET=0, COMMITTED=1, MANAGED=2, REBALANCE=3, REGISTRY=4. creationFee(uint8) is keyed by this index.
const VAULT_TYPE_INDEX: Record<DeployTxRequest["vaultKind"], number> = {
  basket: 0,
  committed: 1,
  managed: 2,
  rebalance: 3,
  registry: 4,
};

interface CreationFee {
  token: `0x${string}`;
  amount: bigint;
}

// CloneFactory charges a fixed per-TYPE USDG fund-creation fee from the deployer at createX().
// The currently-deployed factory predates these getters, so a live read reverts → treat as fee 0
// (same resilience as the mint-time flatCreateFee read). 0 (or revert) ⇒ no approve is prepended.
export async function readCreationFee(deps: DeployDeps, vaultKind: DeployTxRequest["vaultKind"]): Promise<CreationFee> {
  try {
    const [token, amount] = await Promise.all([
      deps.publicClient.readContract({
        address: deps.cloneFactory, abi: CloneFactoryAbi, functionName: "creationFeeToken",
      }) as Promise<`0x${string}`>,
      deps.publicClient.readContract({
        address: deps.cloneFactory, abi: CloneFactoryAbi, functionName: "creationFee", args: [VAULT_TYPE_INDEX[vaultKind]],
      }) as Promise<bigint>,
    ]);
    return { token, amount };
  } catch {
    return { token: zeroAddress, amount: 0n };
  }
}

// USDG approve the deployer must grant the factory before createX pulls the per-TYPE creation fee.
// Empty when the fee is 0 (or the getter reverted on a pre-fee factory).
function creationFeeApproveStep(deps: DeployDeps, fee: CreationFee): BuiltStep[] {
  if (fee.amount <= 0n || fee.token === zeroAddress) return [];
  return [{
    kind: "approve",
    to: fee.token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [deps.cloneFactory, fee.amount] }),
    value: "0",
    contractName: "USDG",
    label: "Approve USDG creation fee",
    summary: `Approve CloneFactory to pull the ${fee.amount.toString()} creation fee in USDG`,
  }];
}

export interface DeployTxRequest {
  account: string;
  vaultKind: "basket" | "managed" | "committed" | "rebalance" | "registry";
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
  } else if (req.vaultKind === "registry") {
    // createRegistryIndex({genesisRoot, tokens, unitSize, name, symbol, manager, managerFeeBps, keeperBps, keeperEscrow}, userSalt).
    // The struct carries genesisRoot + tokens but NOT unitQty (per-token quantities live only in the
    // Merkle leaves + the later bootstrap arg). genesisRoot is computed off-chain from (tokens, unitQty,
    // unitSize); tokens go into the struct in the SAME sorted order the root was built over (deploy-l5.ts).
    const { genesisRoot, sortedTokens } = buildGenesisRoot(tokens, unitQty, unitSize);
    data = encodeFunctionData({
      abi: CloneFactoryAbi,
      functionName: "createRegistryIndex",
      args: [
        {
          genesisRoot,
          tokens: sortedTokens,
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

  const fee = await readCreationFee(deps, req.vaultKind);
  const feeApprove = creationFeeApproveStep(deps, fee);

  const call: BuiltStep = {
    kind: "call",
    to: deps.cloneFactory,
    data,
    value: "0",
    contractName: "CloneFactory",
    label: `Deploy ${req.vaultKind} basket "${req.name}"`,
    summary: `Create a new ${req.vaultKind} vault via CloneFactory for ${req.symbol}`,
    // When a fee approve precedes it the allowance isn't on-chain yet, so the call can't be simulated.
    needsPriorApproval: feeApprove.length > 0,
  };

  return { steps: [...feeApprove, call], finalize: null };
}
