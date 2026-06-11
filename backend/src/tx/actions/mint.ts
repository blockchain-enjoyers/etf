import { encodeFunctionData } from "viem";
import { BasketVaultAbi, CommittedVaultAbi, ManagedRebalanceVaultAbi } from "@meridian/contracts";
import type { MintQuoteResponse } from "@meridian/sdk";
import type { ActionResult, BuiltStep, SignStep } from "../action-registry.js";
import { buildApprovalSteps } from "./approvals.js";
import { mintSummary } from "../summaries.js";

// EIP-2612 typed-data type definitions — mirrors app/src/wallet/use-create-permits.ts PERMIT_TYPES exactly.
const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

// EIP-2612 reads on each constituent — mirrors use-create-permits.ts PERMIT_ABI.
const PERMIT_ABI = [
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

const PERMIT_DEADLINE_SECONDS = 3600n; // use-create-permits.ts: deadline = now + 3600s.

type VaultType = "Basket" | "Managed" | "Committed" | "Rebalance";

interface BasketRow {
  vaultAddress: string;
  symbol: string;
  unitSize: { toFixed: (n: number) => string };
  vaultType: VaultType;
  constituents: { token: string; unitQty: { toFixed: (n: number) => string } }[];
}

export interface MintDeps {
  prisma: {
    basket: { findUnique: (args: unknown) => Promise<BasketRow | null> };
    priceSnapshot: { findFirst: (args: unknown) => Promise<{ price: { toFixed: (n: number) => string } } | null> };
  };
  publicClient: {
    readContract: (args: unknown) => Promise<unknown>;
    multicall: (args: never) => Promise<{ status: string; result?: unknown }[]>;
  };
  meta: { getMany: (tokens: string[]) => Promise<Record<string, { symbol: string; decimals: number }>> };
  chainId: number;
  // Deterministic clock for the permit deadline (unix seconds). Falls back to Date.now() when absent.
  nowSec?: number;
}

interface Deposit {
  token: `0x${string}`;
  amount: bigint;
}

// Mirrors OrderRail.tsx: rebalance vaults are share-based (create takes nShares); all others take nUnits.
function isShareBased(vaultType: VaultType): boolean {
  return vaultType === "Rebalance";
}

// OrderRail.tsx:55 — createArg = isShareBased ? units * unitSize : units.
function createArgFor(basket: BasketRow, units: bigint): bigint {
  return isShareBased(basket.vaultType) ? units * BigInt(basket.unitSize.toFixed(0)) : units;
}

async function loadBasket(deps: MintDeps, vault: string): Promise<BasketRow> {
  const basket = await deps.prisma.basket.findUnique({
    where: { vaultAddress: vault },
    include: { constituents: true },
  });
  if (!basket) throw new Error(`basket ${vault} not found`);
  return basket;
}

// The on-chain pull amounts (the deposit set).
// non-share-based (OrderRail.tsx:68-71): required_i = constituent.unitQty * units.
// share-based (OrderRail.tsx:77-94): previewCreate(createArg) returns wei-exact [tokens, amounts].
async function computeDeposits(deps: MintDeps, basket: BasketRow, units: bigint): Promise<Deposit[]> {
  if (isShareBased(basket.vaultType)) {
    const createArg = createArgFor(basket, units);
    const preview = (await deps.publicClient.readContract({
      address: basket.vaultAddress as `0x${string}`,
      abi: ManagedRebalanceVaultAbi,
      functionName: "previewCreate",
      args: [createArg],
    })) as readonly [readonly `0x${string}`[], readonly bigint[]];
    const [tokens, amounts] = preview;
    return tokens.map((token, i) => ({ token, amount: amounts[i] ?? 0n }));
  }
  return basket.constituents.map((c) => ({
    token: c.token as `0x${string}`,
    amount: BigInt(c.unitQty.toFixed(0)) * units,
  }));
}

function encodeCreate(basket: BasketRow, createArg: bigint): `0x${string}` {
  if (basket.vaultType === "Committed") {
    // use-mint.ts:16-23 — create(nUnits, recipe.tokens, recipe.unitQty); recipe from the prisma constituents.
    const tokens = basket.constituents.map((c) => c.token as `0x${string}`);
    const unitQty = basket.constituents.map((c) => BigInt(c.unitQty.toFixed(0)));
    return encodeFunctionData({ abi: CommittedVaultAbi, functionName: "create", args: [createArg, tokens, unitQty] });
  }
  if (basket.vaultType === "Rebalance") {
    // use-mint.ts mint?.(createArg) → ManagedRebalanceVault.create(nShares).
    return encodeFunctionData({ abi: ManagedRebalanceVaultAbi, functionName: "create", args: [createArg] });
  }
  // basket/managed: use-mint.ts:32-39 — BasketVaultAbi.create(nUnits).
  return encodeFunctionData({ abi: BasketVaultAbi, functionName: "create", args: [createArg] });
}

const VAULT_LABEL: Record<VaultType, string> = {
  Basket: "BasketVault",
  Managed: "ManagedVault",
  Committed: "CommittedVault",
  Rebalance: "ManagedRebalanceVault",
};

export async function quoteMint(
  deps: MintDeps,
  vault: string,
  { units }: { units: string; account?: string },
): Promise<MintQuoteResponse> {
  const basket = await loadBasket(deps, vault);
  const unitsBn = BigInt(units);
  const deposits = await computeDeposits(deps, basket, unitsBn);

  const meta = await deps.meta.getMany(deposits.map((d) => d.token));
  const quoteDeposits = await Promise.all(
    deposits.map(async (d) => {
      const m = meta[d.token.toLowerCase()] ?? { symbol: d.token.slice(0, 6), decimals: 18 };
      const snap = await deps.prisma.priceSnapshot.findFirst({
        where: { token: d.token },
        orderBy: { timestamp: "desc" },
      });
      const price = snap ? BigInt(snap.price.toFixed(0)) : 0n;
      const valueUsd = (d.amount * price) / 10n ** BigInt(m.decimals);
      return { token: d.token, symbol: m.symbol, amount: d.amount.toString(), valueUsd: valueUsd.toString() };
    }),
  );

  const estTotal = quoteDeposits.reduce((s, d) => s + BigInt(d.valueUsd), 0n);
  const unitsOut = createArgFor(basket, unitsBn);

  return {
    unitsOut: unitsOut.toString(),
    deposits: quoteDeposits,
    estTotalUsd: estTotal.toString(),
    gate: { gated: false, reason: "none" },
  };
}

export async function buildMint(
  deps: MintDeps,
  vault: string,
  { account, units }: { account: string; units: string },
): Promise<ActionResult> {
  const basket = await loadBasket(deps, vault);
  const unitsBn = BigInt(units);
  const deposits = await computeDeposits(deps, basket, unitsBn);
  const createArg = createArgFor(basket, unitsBn);

  const approvals = await buildApprovalSteps(
    deps,
    account,
    vault,
    deposits.map((d) => ({ token: d.token, amount: d.amount })),
    "vault",
  );

  const call: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data: encodeCreate(basket, createArg),
    value: "0",
    contractName: VAULT_LABEL[basket.vaultType],
    label: mintSummary(createArg, basket.symbol),
    summary: `Mint ${createArg.toString()} ${basket.symbol} in-kind by depositing ${deposits.length} token${deposits.length === 1 ? "" : "s"}`,
    needsPriorApproval: true,
  };

  return { steps: [...approvals, call], finalize: null };
}

function permitDeadline(deps: MintDeps): bigint {
  const nowSec = deps.nowSec ?? Math.floor(Date.now() / 1000);
  return BigInt(nowSec) + PERMIT_DEADLINE_SECONDS;
}

// EIP-2612 single-tx mint. Basket/Managed only (matches OrderRail.tsx showFastMint: never committed/rebalance).
// Emits one sign712 step per constituent (typed data identical to use-create-permits.ts signPermits),
// then a finalize hop that posts the signatures back to createWithPermit.
export async function buildMintPermit(
  deps: MintDeps,
  vault: string,
  { account, units }: { account: string; units: string },
): Promise<ActionResult> {
  const basket = await loadBasket(deps, vault);
  const unitsBn = BigInt(units);
  // Permit path is non-share-based, so deposits = recipe pulls and createArg = units.
  const deposits = await computeDeposits(deps, basket, unitsBn);
  const deadline = permitDeadline(deps);

  const meta = await deps.meta.getMany(deposits.map((d) => d.token));
  const steps: SignStep[] = await Promise.all(
    deposits.map(async (d) => {
      const [name, nonce, version] = await Promise.all([
        deps.publicClient.readContract({ address: d.token, abi: PERMIT_ABI, functionName: "name" }) as Promise<string>,
        deps.publicClient.readContract({
          address: d.token, abi: PERMIT_ABI, functionName: "nonces", args: [account],
        }) as Promise<bigint>,
        (deps.publicClient.readContract({
          address: d.token, abi: PERMIT_ABI, functionName: "version",
        }) as Promise<string>).catch(() => "1"),
      ]);
      const symbol = meta[d.token.toLowerCase()]?.symbol ?? d.token.slice(0, 6);
      return {
        kind: "sign712" as const,
        token: d.token,
        typedData: {
          domain: { name, version, chainId: deps.chainId, verifyingContract: d.token },
          types: PERMIT_TYPES,
          primaryType: "Permit" as const,
          message: {
            owner: account,
            spender: vault,
            value: d.amount.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
        },
        label: `Sign ${symbol} permit`,
        summary: `Authorize ${vault} to pull ${d.amount.toString()} ${symbol} via EIP-2612 (no approval tx)`,
      };
    }),
  );

  return { steps, finalize: { path: `/baskets/${vault}/tx/mint/finalize` } };
}

interface PermitPost {
  token: string;
  value: string;
  deadline: string;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

// Assemble createWithPermit(nUnits, permits[]) from the signatures the client posts back.
// permits map to the ABI struct order {value, deadline, v, r, s}; `token` is dropped (not in the struct).
// We do NOT re-read nonces here: the client already signed against the nonce it was handed, and finalize
// only encodes calldata from the returned signature components — a stale nonce would simply revert on-chain.
export async function finalizeMintPermit(
  deps: MintDeps,
  vault: string,
  { units, permits }: { account: string; units: string; permits: PermitPost[] },
): Promise<ActionResult> {
  const basket = await loadBasket(deps, vault);
  const createArg = createArgFor(basket, BigInt(units));

  const permitStructs = permits.map((p) => ({
    value: BigInt(p.value),
    deadline: BigInt(p.deadline),
    v: p.v,
    r: p.r,
    s: p.s,
  }));

  const call: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data: encodeFunctionData({ abi: BasketVaultAbi, functionName: "createWithPermit", args: [createArg, permitStructs] }),
    value: "0",
    contractName: VAULT_LABEL[basket.vaultType],
    label: mintSummary(createArg, basket.symbol),
    summary: `Mint ${createArg.toString()} ${basket.symbol} in-kind via ${permitStructs.length} EIP-2612 permit${permitStructs.length === 1 ? "" : "s"} (1 tx)`,
    needsPriorApproval: false,
  };

  return { steps: [call], finalize: null };
}

// Probe EIP-2612 support the way use-create-permits.ts supportsPermit does: nonces(account) must read on
// every constituent. Any failure → not supported (caller falls back to the approve path).
async function supportsPermit(deps: MintDeps, account: string, tokens: `0x${string}`[]): Promise<boolean> {
  if (tokens.length === 0) return false;
  try {
    await Promise.all(
      tokens.map((t) =>
        deps.publicClient.readContract({ address: t, abi: PERMIT_ABI, functionName: "nonces", args: [account] }),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

export type MintMode = "permit" | "approve";

// Chooser: prefer the 1-tx permit path for Basket/Managed vaults (default mode) when every constituent
// exposes nonces(); otherwise fall back to the unchanged approve path. Committed/Rebalance never permit.
export async function buildMintAny(
  deps: MintDeps,
  vault: string,
  { account, units, mode }: { account: string; units: string; mode?: MintMode },
): Promise<ActionResult> {
  if (mode === "approve") return buildMint(deps, vault, { account, units });

  const basket = await loadBasket(deps, vault);
  const permitEligible = basket.vaultType === "Basket" || basket.vaultType === "Managed";
  if (!permitEligible) return buildMint(deps, vault, { account, units });

  const tokens = basket.constituents.map((c) => c.token as `0x${string}`);
  if (!(await supportsPermit(deps, account, tokens))) return buildMint(deps, vault, { account, units });

  return buildMintPermit(deps, vault, { account, units });
}
