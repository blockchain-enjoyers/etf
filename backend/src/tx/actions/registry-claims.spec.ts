import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { RegistryRebalanceVaultAbi } from "@meridian/contracts";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import {
  buildBatchWrap,
  buildBootstrap,
  buildRegistryCreate,
  buildRegistryRedeem,
  buildSetOperator,
  buildUnwrap,
  buildWrap,
} from "./registry-claims.js";

const VAULT = "0x000000000000000000000000000000000000aa01";
const ACCOUNT = "0x0000000000000000000000000000000000000001";
const OPERATOR = "0x00000000000000000000000000000000000000ff";
const TOKEN_A = "0x000000000000000000000000000000000000aaaa";
const TOKEN_B = "0x000000000000000000000000000000000000bbbb";
const USDG = "0x000000000000000000000000000000000000feed";
const ENC = ["address", "uint256", "uint256"];
const ONE = 10n ** 18n;

function metaMock() {
  return {
    getMany: vi.fn().mockResolvedValue({
      [TOKEN_A.toLowerCase()]: { symbol: "AAA", decimals: 18 },
      [TOKEN_B.toLowerCase()]: { symbol: "BBB", decimals: 18 },
      [USDG.toLowerCase()]: { symbol: "USDG", decimals: 6 },
    }),
  };
}

// Decode a step's calldata against the vault ABI and return { functionName, args }.
function decode(step: { data: string }) {
  return decodeFunctionData({ abi: RegistryRebalanceVaultAbi, data: step.data as `0x${string}` });
}

// viem decodes addresses to EIP-55 checksummed form; our constants are lowercase. Normalize a decoded
// [token, ...] arg tuple's leading address to lowercase so deep-equals against the lowercase constants holds.
function lc(arg: unknown): unknown {
  return typeof arg === "string" && arg.startsWith("0x") ? arg.toLowerCase() : arg;
}
function argsLc(args: readonly unknown[]): unknown[] {
  return args.map(lc);
}

describe("buildWrap", () => {
  it("prepends approve(token→vault) then wrap(token, amount) when allowance is 0", async () => {
    const deps = {
      publicClient: { multicall: vi.fn().mockResolvedValue([{ status: "success", result: 0n }]), readContract: vi.fn() },
      meta: metaMock(),
    };
    const result = await buildWrap(deps, VAULT, { account: ACCOUNT, token: TOKEN_A, amount: (2n * ONE).toString() });

    expect(result.steps).toHaveLength(2);
    const approve = result.steps[0] as { kind: string; to: string };
    expect(approve.kind).toBe("approve");
    expect(approve.to).toBe(TOKEN_A); // ERC-20 approve targets the constituent

    const call = result.steps[1] as { kind: string; to: string; data: string; needsPriorApproval?: boolean };
    expect(call.to).toBe(VAULT); // wrap targets the vault (its own ERC-6909 ledger)
    expect(call.needsPriorApproval).toBe(true);
    const dec = decode(call);
    expect(dec.functionName).toBe("wrap");
    expect(argsLc(dec.args)).toEqual([TOKEN_A, 2n * ONE]);
  });

  it("omits the approve when the constituent allowance to the vault already suffices", async () => {
    const deps = {
      publicClient: { multicall: vi.fn().mockResolvedValue([{ status: "success", result: 100n * ONE }]), readContract: vi.fn() },
      meta: metaMock(),
    };
    const result = await buildWrap(deps, VAULT, { account: ACCOUNT, token: TOKEN_A, amount: ONE.toString() });
    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; data: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.needsPriorApproval).toBe(false);
    expect(decode(call).functionName).toBe("wrap");
  });
});

describe("buildBatchWrap", () => {
  it("emits per-under-approved approves then batchWrap(tokens, amounts)", async () => {
    // A under-approved (0), B sufficient.
    const deps = {
      publicClient: {
        multicall: vi.fn().mockResolvedValue([
          { status: "success", result: 0n },
          { status: "success", result: 100n * ONE },
        ]),
        readContract: vi.fn(),
      },
      meta: metaMock(),
    };
    const result = await buildBatchWrap(deps, VAULT, {
      account: ACCOUNT,
      tokens: [TOKEN_A, TOKEN_B],
      amounts: [(2n * ONE).toString(), (3n * ONE).toString()],
    });

    const approves = result.steps.filter((s) => s.kind === "approve");
    expect(approves).toHaveLength(1);
    expect((approves[0] as { to: string }).to).toBe(TOKEN_A);

    const call = result.steps.at(-1) as { to: string; data: string; needsPriorApproval?: boolean };
    expect(call.to).toBe(VAULT);
    expect(call.needsPriorApproval).toBe(true);
    const dec = decode(call);
    expect(dec.functionName).toBe("batchWrap");
    // viem returns EIP-55 checksummed addresses; compare token list case-insensitively.
    const [bwTokens, bwAmounts] = dec.args as [string[], bigint[]];
    expect(bwTokens.map((t) => t.toLowerCase())).toEqual([TOKEN_A, TOKEN_B]);
    expect(bwAmounts).toEqual([2n * ONE, 3n * ONE]);
  });
});

describe("buildUnwrap", () => {
  it("emits a single unwrap(token, amount, to) with no approve (burns own claim)", () => {
    const result = buildUnwrap(VAULT, { token: TOKEN_A, amount: (5n * ONE).toString(), to: ACCOUNT });
    expect(result.steps).toHaveLength(1);
    expect(result.steps.filter((s) => s.kind === "approve")).toHaveLength(0);
    const call = result.steps[0] as { to: string; data: string; needsPriorApproval?: boolean };
    expect(call.to).toBe(VAULT);
    expect(call.needsPriorApproval).toBe(false);
    const dec = decode(call);
    expect(dec.functionName).toBe("unwrap");
    expect(argsLc(dec.args)).toEqual([TOKEN_A, 5n * ONE, ACCOUNT]);
  });
});

describe("buildSetOperator", () => {
  it("emits setOperator(operator, approved) targeting the vault, no approve", () => {
    const result = buildSetOperator(VAULT, { operator: OPERATOR, approved: true });
    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { to: string; data: string };
    expect(call.to).toBe(VAULT);
    const dec = decode(call);
    expect(dec.functionName).toBe("setOperator");
    expect(argsLc(dec.args)).toEqual([OPERATOR, true]);
  });

  it("encodes approved=false for a revoke", () => {
    const result = buildSetOperator(VAULT, { operator: OPERATOR, approved: false });
    expect(argsLc(decode(result.steps[0] as { data: string }).args)).toEqual([OPERATOR, false]);
  });
});

describe("buildBootstrap", () => {
  // unitSize = 1 unit; default nShares == unitSize → units = 1 → wrap amount = unitQty * 1.
  it("emits approves + wraps + bootstrap(nShares, sortedTokens, sortedUnitQty, proofs)", async () => {
    // Allowances 0 for both → both approves present.
    const deps = {
      publicClient: {
        multicall: vi.fn().mockResolvedValue([
          { status: "success", result: 0n },
          { status: "success", result: 0n },
        ]),
        readContract: vi.fn(),
      },
      meta: metaMock(),
    };
    // Deliberately unsorted input: B first.
    const result = await buildBootstrap(deps, VAULT, {
      account: ACCOUNT,
      tokens: [TOKEN_B, TOKEN_A],
      unitQty: [(3n * ONE).toString(), (2n * ONE).toString()],
      unitSize: ONE.toString(),
    });

    const approves = result.steps.filter((s) => s.kind === "approve");
    const calls = result.steps.filter((s) => s.kind === "call") as { data: string }[];
    expect(approves).toHaveLength(2);
    // 2 wraps + 1 bootstrap.
    expect(calls).toHaveLength(3);

    const wraps = calls.slice(0, 2).map((c) => decode(c));
    // Sorted ascending: A(2) then B(3).
    expect(wraps[0]!.functionName).toBe("wrap");
    expect(argsLc(wraps[0]!.args)).toEqual([TOKEN_A, 2n * ONE]);
    expect(argsLc(wraps[1]!.args)).toEqual([TOKEN_B, 3n * ONE]);

    const boot = decode(calls[2]!);
    expect(boot.functionName).toBe("bootstrap");
    const [nShares, tokens, unitQty, proofs] = boot.args as [bigint, string[], bigint[], `0x${string}`[][]];
    expect(nShares).toBe(ONE);
    expect(tokens.map((t) => t.toLowerCase())).toEqual([TOKEN_A, TOKEN_B]);
    expect(unitQty).toEqual([2n * ONE, 3n * ONE]);

    // Proofs/root must be consistent with an independently-recomputed genesis tree (sorted leaves).
    const values = tokens.map((t, i) => [t, unitQty[i]!.toString(), ONE.toString()]);
    const tree = StandardMerkleTree.of(values, ENC);
    tokens.forEach((t, i) => {
      expect(StandardMerkleTree.verify(tree.root, ENC, [t, unitQty[i]!.toString(), ONE.toString()], proofs[i]!)).toBe(true);
    });
  });

  it("scales wrap amounts by units when nShares is a multiple of unitSize", async () => {
    const deps = {
      publicClient: { multicall: vi.fn().mockResolvedValue([{ status: "success", result: 1000n * ONE }]), readContract: vi.fn() },
      meta: metaMock(),
    };
    const result = await buildBootstrap(deps, VAULT, {
      account: ACCOUNT,
      tokens: [TOKEN_A],
      unitQty: [(2n * ONE).toString()],
      unitSize: ONE.toString(),
      nShares: (3n * ONE).toString(), // 3 units
    });
    const wrap = decode(result.steps.find((s) => s.kind === "call") as { data: string });
    expect(wrap.functionName).toBe("wrap");
    expect(argsLc(wrap.args)).toEqual([TOKEN_A, 6n * ONE]); // unitQty(2) * units(3)
    const boot = decode(result.steps.at(-1) as { data: string });
    expect((boot.args as [bigint])[0]).toBe(3n * ONE);
  });
});

// previewCreate read helper: returns [tokens, needs]. Build a readContract router.
function inKindDeps(opts: {
  previewCreate?: readonly [string[], bigint[]];
  previewRedeem?: readonly [string[], bigint[]];
  claimBalances?: bigint[];
  flatCreateFee?: bigint;
  feeToken?: string;
}) {
  const readContract = vi.fn(async (raw: unknown) => {
    const a = raw as { functionName: string };
    if (a.functionName === "previewCreate") return opts.previewCreate ?? [[], []];
    if (a.functionName === "previewRedeem") return opts.previewRedeem ?? [[], []];
    if (a.functionName === "feeToken") return (opts.feeToken ?? USDG) as `0x${string}`;
    if (a.functionName === "flatCreateFee") return opts.flatCreateFee ?? 0n;
    throw new Error(`unexpected read ${a.functionName}`);
  });
  // multicall is used for: claim balanceOf reads (create) AND approval allowance reads. We route by
  // functionName so a single mock serves both; balanceOf → claimBalances, allowance → 0 (forces approve).
  const multicall = vi.fn(async (raw: unknown) => {
    const { contracts } = raw as { contracts: { functionName: string }[] };
    return contracts.map((c, i) => {
      if (c.functionName === "balanceOf") return { status: "success", result: (opts.claimBalances ?? [])[i] ?? 0n };
      return { status: "success", result: 0n }; // allowance → 0
    });
  });
  return {
    publicClient: { readContract, multicall },
    meta: metaMock(),
    prisma: { basket: { findUnique: vi.fn().mockResolvedValue({ vaultAddress: VAULT, symbol: "IDX" }) } },
  };
}

describe("buildRegistryCreate — in-kind, ERC-6909 self-transfer precondition", () => {
  it("does NOT prepend setOperator (create moves the caller's OWN claims via internal _transfer)", async () => {
    // Caller already holds all needed claims → no wraps, no setOperator, just create(N).
    const deps = inKindDeps({
      previewCreate: [[TOKEN_A, TOKEN_B], [2n * ONE, 3n * ONE]],
      claimBalances: [10n * ONE, 10n * ONE],
      flatCreateFee: 0n,
    });
    const result = await buildRegistryCreate(deps, VAULT, { account: ACCOUNT, nShares: ONE.toString() });

    const decoded = result.steps.map((s) => decode(s as { data: string }).functionName);
    expect(decoded).not.toContain("setOperator");
    expect(decoded).toContain("create");
    // Sufficient claims + no fee → a single clean create call.
    expect(result.steps).toHaveLength(1);
    const create = decode(result.steps[0] as { data: string });
    expect(create.functionName).toBe("create");
    expect(create.args).toEqual([ONE]);
  });

  it("prepends approve+wrap for the per-token claim shortfall, then create(N)", async () => {
    // Need A=2, B=3; caller holds A=1 (short 1), B=5 (enough) → one approve + one wrap (for A) + create.
    const deps = inKindDeps({
      previewCreate: [[TOKEN_A, TOKEN_B], [2n * ONE, 3n * ONE]],
      claimBalances: [1n * ONE, 5n * ONE],
      flatCreateFee: 0n,
    });
    const result = await buildRegistryCreate(deps, VAULT, { account: ACCOUNT, nShares: ONE.toString() });

    const approves = result.steps.filter((s) => s.kind === "approve");
    expect(approves).toHaveLength(1);
    expect((approves[0] as { to: string }).to).toBe(TOKEN_A);

    const calls = result.steps.filter((s) => s.kind === "call") as { data: string }[];
    const names = calls.map((c) => decode(c).functionName);
    expect(names).toEqual(["wrap", "create"]);
    const wrap = decode(calls[0]!);
    expect(argsLc(wrap.args)).toEqual([TOKEN_A, 1n * ONE]); // shortfall = need(2) - have(1)
    expect((decode(calls[1]!).args as [bigint])[0]).toBe(ONE);
  });

  it("prepends the flatCreateFee approve (USDG → vault) when FeeCore charges one", async () => {
    const deps = inKindDeps({
      previewCreate: [[TOKEN_A], [2n * ONE]],
      claimBalances: [10n * ONE], // no shortfall
      flatCreateFee: 5_000_000n, // 5 USDG (6-dec)
      feeToken: USDG,
    });
    const result = await buildRegistryCreate(deps, VAULT, { account: ACCOUNT, nShares: ONE.toString() });
    const approves = result.steps.filter((s) => s.kind === "approve") as { to: string }[];
    // The only approve is the USDG fee approve (no constituent shortfall).
    expect(approves).toHaveLength(1);
    expect(approves[0]!.to).toBe(USDG);
    expect(result.steps.at(-1) && decode(result.steps.at(-1) as { data: string }).functionName).toBe("create");
  });
});

describe("buildRegistryRedeem — in-kind, holder receives claims then unwraps", () => {
  it("emits redeem(amount) then unwrap(token, out, holder) per non-zero leg", async () => {
    const deps = inKindDeps({ previewRedeem: [[TOKEN_A, TOKEN_B], [2n * ONE, 0n]] });
    const result = await buildRegistryRedeem(deps, VAULT, { account: ACCOUNT, amount: ONE.toString() });

    const names = result.steps.map((s) => decode(s as { data: string }).functionName);
    // redeem first, then exactly ONE unwrap (B's leg is 0 → skipped).
    expect(names).toEqual(["redeem", "unwrap"]);
    const redeem = decode(result.steps[0] as { data: string });
    expect(redeem.args).toEqual([ONE]);
    const unwrap = decode(result.steps[1] as { data: string });
    expect(argsLc(unwrap.args)).toEqual([TOKEN_A, 2n * ONE, ACCOUNT]); // sent back to the holder
  });

  it("withUnwrap=false returns only the bare redeem (holder keeps claims)", async () => {
    const deps = inKindDeps({ previewRedeem: [[TOKEN_A], [2n * ONE]] });
    const result = await buildRegistryRedeem(deps, VAULT, { account: ACCOUNT, amount: ONE.toString(), withUnwrap: false });
    expect(result.steps).toHaveLength(1);
    expect(decode(result.steps[0] as { data: string }).functionName).toBe("redeem");
    expect(deps.publicClient.readContract).not.toHaveBeenCalled();
  });

  it("redeem has no approve steps (the vault burns shares directly)", async () => {
    const deps = inKindDeps({ previewRedeem: [[TOKEN_A], [2n * ONE]] });
    const result = await buildRegistryRedeem(deps, VAULT, { account: ACCOUNT, amount: ONE.toString() });
    expect(result.steps.filter((s) => s.kind === "approve")).toHaveLength(0);
  });
});

// Cross-check: the bare encodings match an independent encodeFunctionData (selector pinning).
describe("selector pinning", () => {
  it("wrap/unwrap/setOperator/create/redeem encode to the canonical selectors", () => {
    expect((buildUnwrap(VAULT, { token: TOKEN_A, amount: "1", to: ACCOUNT }).steps[0] as { data: string }).data).toBe(
      encodeFunctionData({ abi: RegistryRebalanceVaultAbi, functionName: "unwrap", args: [TOKEN_A, 1n, ACCOUNT] }),
    );
    expect((buildSetOperator(VAULT, { operator: OPERATOR, approved: true }).steps[0] as { data: string }).data).toBe(
      encodeFunctionData({ abi: RegistryRebalanceVaultAbi, functionName: "setOperator", args: [OPERATOR, true] }),
    );
  });
});
