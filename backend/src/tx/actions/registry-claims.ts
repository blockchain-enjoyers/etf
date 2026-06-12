import { encodeFunctionData } from "viem";
import { RegistryRebalanceVaultAbi } from "@meridian/contracts";
import type { ActionResult, BuiltStep } from "../action-registry.js";
import { buildApprovalSteps, type ApprovalDeps } from "./approvals.js";
import { buildBootstrapProofs } from "../registry-recipe.js";
import { formatTokenAmount } from "../summaries.js";

// The registry (5th) vault type custodies constituents as ERC-6909 CLAIMS (RegistryCustody). These
// builders cover the AP/holder claim lifecycle: wrap real ERC-20 -> claims, bootstrap (genesis mint),
// in-kind create/redeem (move claims <-> shares), unwrap claims -> ERC-20, setOperator (authorize a
// queue/operator over your claims). The vault contract IS its own ERC-6909 ledger, so every claim call
// (wrap/unwrap/setOperator/create/redeem/bootstrap) targets the vault address itself; the constituent
// ERC-20 approve targets the vault too (wrap pulls via safeTransferFrom).

const CONTRACT = "RegistryRebalanceVault";

export interface RegistryClaimsDeps extends ApprovalDeps {
  // Per-token claim balances + the flat-create-fee getters + previewCreate/previewRedeem reads.
  publicClient: ApprovalDeps["publicClient"] & {
    readContract: (args: unknown) => Promise<unknown>;
  };
}

// --- wrap: real ERC-20 -> ERC-6909 claim id (the only external pull-in) ---
// PRECONDITION: wrap() does IERC20(token).safeTransferFrom(msg.sender, vault, amount), so the caller
// must approve the VAULT to pull `amount` of the constituent first (skip when allowance suffices).
export async function buildWrap(
  deps: RegistryClaimsDeps,
  vault: string,
  { account, token, amount }: { account: string; token: string; amount: string },
): Promise<ActionResult> {
  const amountBn = BigInt(amount);
  const approvals = await buildApprovalSteps(deps, account, vault, [{ token, amount: amountBn }], "vault");

  const data = encodeFunctionData({
    abi: RegistryRebalanceVaultAbi,
    functionName: "wrap",
    args: [token as `0x${string}`, amountBn],
  });
  const call: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data,
    value: "0",
    contractName: CONTRACT,
    label: "Wrap constituent into claim",
    summary: `Deposit ${amount} of ${token} and receive an equal ERC-6909 claim`,
    needsPriorApproval: approvals.length > 0,
  };
  return { steps: [...approvals, call], finalize: null };
}

// --- batchWrap: turn up to chunkSize constituents into claims in one tx (the AP inventory build) ---
// PRECONDITION: each token must be approved to the vault (batchWrap pulls every token via safeTransferFrom).
export async function buildBatchWrap(
  deps: RegistryClaimsDeps,
  vault: string,
  { account, tokens, amounts }: { account: string; tokens: string[]; amounts: string[] },
): Promise<ActionResult> {
  if (tokens.length !== amounts.length) throw new Error("tokens/amounts length mismatch");
  const amountsBn = amounts.map((a) => BigInt(a));
  const approvals = await buildApprovalSteps(
    deps,
    account,
    vault,
    tokens.map((token, i) => ({ token, amount: amountsBn[i]! })),
    "vault",
  );

  const data = encodeFunctionData({
    abi: RegistryRebalanceVaultAbi,
    functionName: "batchWrap",
    args: [tokens as `0x${string}`[], amountsBn],
  });
  const call: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data,
    value: "0",
    contractName: CONTRACT,
    label: `Batch-wrap ${tokens.length} constituents`,
    summary: `Deposit ${tokens.length} constituents and receive their ERC-6909 claims in one tx`,
    needsPriorApproval: approvals.length > 0,
  };
  return { steps: [...approvals, call], finalize: null };
}

// --- unwrap: burn own claim id -> send real ERC-20 to `to` (the only external send-out) ---
// No approve: unwrap() burns the CALLER's own claim (no allowance/operator involved).
export function buildUnwrap(
  vault: string,
  { token, amount, to }: { token: string; amount: string; to: string },
): ActionResult {
  const data = encodeFunctionData({
    abi: RegistryRebalanceVaultAbi,
    functionName: "unwrap",
    args: [token as `0x${string}`, BigInt(amount), to as `0x${string}`],
  });
  const call: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data,
    value: "0",
    contractName: CONTRACT,
    label: "Unwrap claim into constituent",
    summary: `Burn ${amount} of the ${token} claim and send the real ERC-20 to ${to}`,
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}

// --- setOperator: ERC-6909 operator authorization over the caller's claims ---
// Lets a queue/settler (e.g. the L5 ForwardCashQueue) move the caller's claims via transferFrom
// (settleCreate's pull-from-AP path). No approve; this IS the authorization.
export function buildSetOperator(
  vault: string,
  { operator, approved }: { operator: string; approved: boolean },
): ActionResult {
  const data = encodeFunctionData({
    abi: RegistryRebalanceVaultAbi,
    functionName: "setOperator",
    args: [operator as `0x${string}`, approved],
  });
  const call: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data,
    value: "0",
    contractName: CONTRACT,
    label: approved ? "Authorize operator over claims" : "Revoke operator over claims",
    summary: `${approved ? "Authorize" : "Revoke"} ${operator} as an ERC-6909 operator over your claims`,
    needsPriorApproval: false,
  };
  return { steps: [call], finalize: null };
}

// --- bootstrap: genesis mint, Merkle-proof-gated ---
// Plan (per deploy-l5.ts): per token approve(vault) + wrap(token, unitQty*units), then
// bootstrap(unitSize, sortedTokens, sortedUnitQty, proofs). bootstrap() does _custodyIn(msg.sender, ...)
// (internal claim _transfer from the caller), so the caller must hold the claims first => the wraps.
// nShares == unitSize here (1 unit) to match the deploy reference; per-token wrap amount = unitQty*units.
// Tokens/qty are sorted identically to buildGenesisRoot so the proofs verify against the genesis root.
export async function buildBootstrap(
  deps: RegistryClaimsDeps,
  vault: string,
  {
    account,
    tokens,
    unitQty,
    unitSize,
    nShares,
  }: { account: string; tokens: string[]; unitQty: string[]; unitSize: string; nShares?: string },
): Promise<ActionResult> {
  if (tokens.length !== unitQty.length) throw new Error("tokens/unitQty length mismatch");
  const unitSizeBn = BigInt(unitSize);
  const sharesBn = nShares !== undefined ? BigInt(nShares) : unitSizeBn;
  if (sharesBn === 0n || sharesBn % unitSizeBn !== 0n) throw new Error("nShares must be a non-zero multiple of unitSize");
  const units = sharesBn / unitSizeBn;

  const { sortedTokens, sortedUnitQty, proofs } = buildBootstrapProofs(
    tokens as `0x${string}`[],
    unitQty.map((q) => BigInt(q)),
    unitSizeBn,
  );
  // Per-token claim amount the bootstrap pulls = unitQty * units (the genesis seed for `units` units).
  const wrapAmounts = sortedUnitQty.map((q) => q * units);

  // One approve+wrap per constituent, ordered like the sorted tokens (the wraps must precede bootstrap).
  const approvals = await buildApprovalSteps(
    deps,
    account,
    vault,
    sortedTokens.map((token, i) => ({ token, amount: wrapAmounts[i]! })),
    "vault",
  );
  const wrapSteps: BuiltStep[] = sortedTokens.map((token, i) => ({
    kind: "call",
    to: vault as `0x${string}`,
    data: encodeFunctionData({ abi: RegistryRebalanceVaultAbi, functionName: "wrap", args: [token, wrapAmounts[i]!] }),
    value: "0",
    contractName: CONTRACT,
    label: "Wrap genesis constituent",
    summary: `Deposit ${wrapAmounts[i]!.toString()} of ${token} into custody as a claim`,
    needsPriorApproval: true, // depends on the matching approve having landed first
  }));

  const bootstrapData = encodeFunctionData({
    abi: RegistryRebalanceVaultAbi,
    functionName: "bootstrap",
    args: [sharesBn, sortedTokens, sortedUnitQty, proofs],
  });
  const bootstrapCall: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data: bootstrapData,
    value: "0",
    contractName: CONTRACT,
    label: "Bootstrap (genesis mint)",
    summary: `Seed custody from the wrapped claims and mint ${sharesBn.toString()} shares (Merkle-proof-gated)`,
    needsPriorApproval: true, // depends on the wraps above
  };

  return { steps: [...approvals, ...wrapSteps, bootstrapCall], finalize: null };
}

interface RegistryBasketRow {
  vaultAddress: string;
  symbol: string;
}

export interface RegistryInKindDeps extends RegistryClaimsDeps {
  prisma: { basket: { findUnique: (args: unknown) => Promise<RegistryBasketRow | null> } };
}

async function loadRegistryBasket(deps: RegistryInKindDeps, vault: string): Promise<RegistryBasketRow> {
  const basket = await deps.prisma.basket.findUnique({ where: { vaultAddress: vault } });
  if (!basket) throw new Error(`basket ${vault} not found`);
  return basket;
}

// FeeCore.create() pulls a fixed flatCreateFee in feeToken (USDG) from msg.sender (the AP). Read it so
// the caller can approve the matching amount to the vault; a pre-fee deployment lacks the getters.
async function flatCreateFeeApproval(deps: RegistryInKindDeps, account: string, vault: string): Promise<BuiltStep[]> {
  try {
    const [feeToken, fee] = await Promise.all([
      deps.publicClient.readContract({ address: vault as `0x${string}`, abi: RegistryRebalanceVaultAbi, functionName: "feeToken" }) as Promise<`0x${string}`>,
      deps.publicClient.readContract({ address: vault as `0x${string}`, abi: RegistryRebalanceVaultAbi, functionName: "flatCreateFee" }) as Promise<bigint>,
    ]);
    if (fee <= 0n) return [];
    return buildApprovalSteps(deps, account, vault, [{ token: feeToken, amount: fee }], "fee");
  } catch {
    return [];
  }
}

// --- registry in-kind create(N): pull the caller's OWN claims pro-rata, mint N shares ---
//
// ERC-6909 PRECONDITION (encoded): RebalanceCore.create(N) moves claims via _portIn(msg.sender, ...) ->
// RegistryCustody._custodyIn, an INTERNAL _transfer(from == msg.sender, vault). The internal _transfer
// does NO ERC-6909 allowance/operator check, so create needs NO setOperator(vault) — it requires the
// caller to already HOLD the per-token claim need. (Contrast settleCreate, which uses the PUBLIC
// transferFrom(ap, ...) and therefore needs the AP to setOperator(settler); that is the queue's path,
// not this self-create.) We therefore satisfy the real precondition by ensuring the caller holds the
// claims: read previewCreate(N) for the per-token need, read the caller's claim balance, and prepend an
// approve+wrap for any shortfall. Then create(N). Plus the FeeCore flatCreateFee approve.
export async function buildRegistryCreate(
  deps: RegistryInKindDeps,
  vault: string,
  { account, nShares }: { account: string; nShares: string },
): Promise<ActionResult> {
  const basket = await loadRegistryBasket(deps, vault);
  const sharesBn = BigInt(nShares);

  const [tokens, needs] = (await deps.publicClient.readContract({
    address: vault as `0x${string}`,
    abi: RegistryRebalanceVaultAbi,
    functionName: "previewCreate",
    args: [sharesBn],
  })) as readonly [readonly `0x${string}`[], readonly bigint[]];

  // Per-token claim shortfall = need - current claim balance (id = uint160(token)); wrap covers it.
  const balances = (await deps.publicClient.multicall({
    allowFailure: true,
    contracts: tokens.map((t) => ({
      address: vault as `0x${string}`,
      abi: RegistryRebalanceVaultAbi,
      functionName: "balanceOf",
      args: [account as `0x${string}`, BigInt(BigInt(t))], // balanceOf(owner, id), id = uint160(token)
    })),
  } as never)) as { status: string; result?: unknown }[];

  const wrapNeeds = tokens
    .map((token, i) => {
      const r = balances[i];
      const have = r?.status === "success" ? (r.result as bigint) : 0n;
      const need = needs[i] ?? 0n;
      const short = need > have ? need - have : 0n;
      return { token, amount: short };
    })
    .filter((w) => w.amount > 0n);

  // Approves (constituent shortfalls + the USDG fee), then the matching wraps, then create(N).
  const wrapApprovals = await buildApprovalSteps(deps, account, vault, wrapNeeds, "vault");
  const feeApproval = await flatCreateFeeApproval(deps, account, vault);
  const wrapSteps: BuiltStep[] = wrapNeeds.map((w) => ({
    kind: "call",
    to: vault as `0x${string}`,
    data: encodeFunctionData({ abi: RegistryRebalanceVaultAbi, functionName: "wrap", args: [w.token, w.amount] }),
    value: "0",
    contractName: CONTRACT,
    label: "Wrap constituent into claim",
    summary: `Deposit ${w.amount.toString()} of ${w.token} as a claim to cover the create need`,
    needsPriorApproval: true,
  }));

  const createCall: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data: encodeFunctionData({ abi: RegistryRebalanceVaultAbi, functionName: "create", args: [sharesBn] }),
    value: "0",
    contractName: CONTRACT,
    label: `Create ${formatTokenAmount(sharesBn, 18, basket.symbol)}`,
    summary: `Move your pro-rata claims into the vault and mint ${sharesBn.toString()} ${basket.symbol} (in-kind, claims you already hold)`,
    // Depends on the wraps/fee approve landing first; cleanly simulatable only when none are needed.
    needsPriorApproval: wrapSteps.length > 0 || feeApproval.length > 0,
  };

  return { steps: [...feeApproval, ...wrapApprovals, ...wrapSteps, createCall], finalize: null };
}

// --- registry in-kind redeem(amount): burn shares, receive claims, then unwrap to real ERC-20 ---
//
// ERC-6909 PRECONDITION (encoded): RebalanceCore.redeem(amount) pays out via _portOut(msg.sender, ...)
// -> the HOLDER receives ERC-6909 CLAIMS (not real ERC-20). To leave the holder with real tokens we
// chain an unwrap(token, out, holder) per held token after the redeem. redeem itself needs no approve
// (the vault burns the holder's shares directly). `withUnwrap=false` returns just the bare redeem.
export async function buildRegistryRedeem(
  deps: RegistryInKindDeps,
  vault: string,
  { account, amount, withUnwrap = true }: { account: string; amount: string; withUnwrap?: boolean },
): Promise<ActionResult> {
  const basket = await loadRegistryBasket(deps, vault);
  const amountBn = BigInt(amount);

  const redeemCall: BuiltStep = {
    kind: "call",
    to: vault as `0x${string}`,
    data: encodeFunctionData({ abi: RegistryRebalanceVaultAbi, functionName: "redeem", args: [amountBn] }),
    value: "0",
    contractName: CONTRACT,
    label: `Redeem ${formatTokenAmount(amountBn, 18, basket.symbol)}`,
    summary: `Burn ${amount} ${basket.symbol} and receive the underlying as ERC-6909 claims`,
    needsPriorApproval: false,
  };

  if (!withUnwrap) return { steps: [redeemCall], finalize: null };

  // previewRedeem(amount) mirrors redeem's pro-rata payout exactly; unwrap each non-zero output to the holder.
  const [tokens, outs] = (await deps.publicClient.readContract({
    address: vault as `0x${string}`,
    abi: RegistryRebalanceVaultAbi,
    functionName: "previewRedeem",
    args: [amountBn],
  })) as readonly [readonly `0x${string}`[], readonly bigint[]];

  const unwrapSteps: BuiltStep[] = tokens
    .map((token, i) => ({ token, amount: outs[i] ?? 0n }))
    .filter((u) => u.amount > 0n)
    .map((u) => ({
      kind: "call" as const,
      to: vault as `0x${string}`,
      data: encodeFunctionData({ abi: RegistryRebalanceVaultAbi, functionName: "unwrap", args: [u.token, u.amount, account as `0x${string}`] }),
      value: "0",
      contractName: CONTRACT,
      label: "Unwrap claim into constituent",
      summary: `Burn ${u.amount.toString()} of the ${u.token} claim and send the real ERC-20 back to you`,
      // The claim only exists after redeem lands, so these can't be simulated pre-redeem.
      needsPriorApproval: true,
    }));

  return { steps: [redeemCall, ...unwrapSteps], finalize: null };
}
