import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, erc20Abi } from "viem";
import { BasketVaultAbi, CommittedVaultAbi, ManagedRebalanceVaultAbi } from "@meridian/contracts";
import { quoteMint, buildMint, buildMintPermit, finalizeMintPermit, buildMintAny } from "./mint.js";

const CHAIN_ID = 421614;

const VAULT = "0x000000000000000000000000000000000000aa01";
const ACCOUNT = "0x0000000000000000000000000000000000000001";
const TOKEN_A = "0x000000000000000000000000000000000000000a";
const TOKEN_B = "0x000000000000000000000000000000000000000b";

// Prisma Decimal is mimicked: holdings.service reads it via `.toFixed(0)`.
const dec = (v: string) => ({ toFixed: (_n: number) => v });

function basketRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    vaultAddress: VAULT,
    symbol: "IDX",
    unitSize: dec("1000000000000000000"),
    vaultType: "Basket",
    constituents: [{ token: TOKEN_A, unitQty: dec("1000000000000000000") }],
    ...over,
  };
}

function makeDeps(opts: {
  basket: unknown;
  allowances?: bigint[];
  price?: string;
  meta?: Record<string, { symbol: string; decimals: number }>;
  preview?: readonly [readonly `0x${string}`[], readonly bigint[]];
}) {
  return {
    prisma: {
      basket: { findUnique: vi.fn().mockResolvedValue(opts.basket) },
      priceSnapshot: {
        findFirst: vi.fn().mockResolvedValue(opts.price ? { price: dec(opts.price) } : null),
      },
    },
    publicClient: {
      multicall: vi.fn().mockResolvedValue((opts.allowances ?? []).map((a) => ({ status: "success", result: a }))),
      readContract: vi.fn().mockResolvedValue(opts.preview),
    },
    meta: {
      getMany: vi.fn().mockResolvedValue(
        opts.meta ?? {
          [TOKEN_A]: { symbol: "AAA", decimals: 18 },
          [TOKEN_B]: { symbol: "BBB", decimals: 18 },
        },
      ),
    },
    chainId: CHAIN_ID,
  };
}

// Permit deps: readContract is routed by functionName so name/nonces/version each return a stub.
// `noncesThrows` simulates a non-EIP-2612 token (the supportsPermit probe fails).
function makePermitDeps(opts: {
  basket: unknown;
  nonces?: bigint;
  name?: string;
  versionThrows?: boolean;
  noncesThrows?: boolean;
  nowSec?: number;
  meta?: Record<string, { symbol: string; decimals: number }>;
}) {
  const readContract = vi.fn(async (raw: unknown) => {
    const args = raw as { functionName: string };
    switch (args.functionName) {
      case "name":
        return opts.name ?? "Token A";
      case "nonces":
        if (opts.noncesThrows) throw new Error("not EIP-2612");
        return opts.nonces ?? 7n;
      case "version":
        if (opts.versionThrows) throw new Error("no version()");
        return "2";
      default:
        throw new Error(`unexpected read ${args.functionName}`);
    }
  });
  return {
    prisma: {
      basket: { findUnique: vi.fn().mockResolvedValue(opts.basket) },
      priceSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    publicClient: {
      multicall: vi.fn().mockResolvedValue([]),
      readContract,
    },
    meta: {
      getMany: vi.fn().mockResolvedValue(
        opts.meta ?? {
          [TOKEN_A]: { symbol: "AAA", decimals: 18 },
          [TOKEN_B]: { symbol: "BBB", decimals: 18 },
        },
      ),
    },
    chainId: CHAIN_ID,
    nowSec: opts.nowSec,
  };
}

describe("quoteMint / buildMint — basket vault (non-share-based)", () => {
  // FE formula (OrderRail.tsx): createArg = units; deposit_i = constituent.unitQty * units.
  // units=3, unitQty=1e18 → amount = 3e18; createArg = 3.
  const units = "3";
  const expectedAmount = 3000000000000000000n; // 1e18 * 3

  it("quoteMint returns one deposit with FE-correct amount + valueUsd", async () => {
    // price = 2e18 (18-dec USD), decimals 18 → valueUsd = amount*price/1e18 = 3e18*2 = 6e18.
    const deps = makeDeps({ basket: basketRow(), price: "2000000000000000000" });
    const q = await quoteMint(deps, VAULT, { units });
    expect(q.deposits).toHaveLength(1);
    expect(q.deposits[0]!.token).toBe(TOKEN_A);
    expect(q.deposits[0]!.symbol).toBe("AAA");
    expect(q.deposits[0]!.amount).toBe(expectedAmount.toString());
    expect(q.deposits[0]!.valueUsd).toBe("6000000000000000000");
    expect(q.estTotalUsd).toBe("6000000000000000000");
    expect(q.unitsOut).toBe("3");
    expect(q.gate).toEqual({ gated: false, reason: "none" });
  });

  it("buildMint returns [approve(under-allowed), call] with FE-correct create(units) calldata", async () => {
    // allowance 0 < required 3e18 → one approve emitted.
    const deps = makeDeps({ basket: basketRow(), allowances: [0n] });
    const res = await buildMint(deps, VAULT, { account: ACCOUNT, units });

    expect(res.steps).toHaveLength(2);
    const [approve, call] = res.steps as unknown as [
      { kind: string; to: string },
      { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean; contractName: string },
    ];
    expect(approve.kind).toBe("approve");
    expect(approve.to).toBe(TOKEN_A);

    expect(call.kind).toBe("call");
    expect(call.to).toBe(VAULT);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(true);
    expect(call.contractName).toBe("BasketVault");
    // Independent FE-formula calldata: BasketVault.create(units) with units=3.
    const expected = encodeFunctionData({ abi: BasketVaultAbi, functionName: "create", args: [3n] });
    expect(call.data).toBe(expected);
  });

  it("buildMint omits approve when allowance already covers the pull", async () => {
    const deps = makeDeps({ basket: basketRow(), allowances: [expectedAmount] });
    const res = await buildMint(deps, VAULT, { account: ACCOUNT, units });
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0]!.kind).toBe("call");
  });
});

// Fee deps: readContract is routed by functionName so feeToken/flatCreateFee resolve; every allowance
// reads back 0 so each token (fee + constituents) emits an approve. Tracks the readContract spy so a
// test can assert the no-op fee seam performs no on-chain read.
const FEE_TOKEN = "0x000000000000000000000000000000000000feed";
function makeFeeDeps(opts: {
  basket: unknown;
  feeToken?: string;
  flatCreateFee?: bigint;
  meta?: Record<string, { symbol: string; decimals: number }>;
}) {
  const readContract = vi.fn(async (raw: unknown) => {
    const args = raw as { functionName: string };
    if (args.functionName === "feeToken") return opts.feeToken ?? FEE_TOKEN;
    if (args.functionName === "flatCreateFee") return opts.flatCreateFee ?? 0n;
    throw new Error(`unexpected read ${args.functionName}`);
  });
  return {
    prisma: {
      basket: { findUnique: vi.fn().mockResolvedValue(opts.basket) },
      priceSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    publicClient: {
      // allowance multicall: always 0 → under-approved → approve emitted.
      multicall: vi.fn(async (raw: unknown) => {
        const { contracts } = raw as { contracts: unknown[] };
        return contracts.map(() => ({ status: "success", result: 0n }));
      }),
      readContract,
    },
    meta: {
      getMany: vi.fn().mockResolvedValue(
        opts.meta ?? {
          [TOKEN_A]: { symbol: "AAA", decimals: 18 },
          [FEE_TOKEN]: { symbol: "USDG", decimals: 6 },
        },
      ),
    },
    chainId: CHAIN_ID,
  };
}

describe("mint flatCreateFee (FeeCore vaults)", () => {
  const FEE = 5_000_000n; // 5 USDG @ 6-dec

  it("managed vault: prepends USDG fee approve as the FIRST step (feeToken → vault, flatCreateFee)", async () => {
    const basket = basketRow({ vaultType: "Managed" });
    const deps = makeFeeDeps({ basket, flatCreateFee: FEE });
    const res = await buildMint(deps, VAULT, { account: ACCOUNT, units: "3" });

    // [feeApprove, constituentApprove, call] — fee approval is first.
    const first = res.steps[0] as { kind: string; to: string; data: string };
    expect(first.kind).toBe("approve");
    expect(first.to).toBe(FEE_TOKEN);
    const expectedApprove = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [VAULT as `0x${string}`, FEE],
    });
    expect(first.data).toBe(expectedApprove);

    // The mint call is still last and targets the vault.
    expect(res.steps.at(-1)!.kind).toBe("call");
  });

  it("managed vault: quoteMint returns the fee (symbol/amount/valueUsd scaled to 18-dec USD)", async () => {
    const basket = basketRow({ vaultType: "Managed" });
    const deps = makeFeeDeps({ basket, flatCreateFee: FEE });
    const q = await quoteMint(deps, VAULT, { units: "3" });

    expect(q.fee).toBeDefined();
    expect(q.fee!.token).toBe(FEE_TOKEN);
    expect(q.fee!.symbol).toBe("USDG");
    expect(q.fee!.amount).toBe(FEE.toString());
    // 5e6 (6-dec) → 5e18 (18-dec USD): 5_000_000 * 1e18 / 1e6 = 5e18.
    expect(q.fee!.valueUsd).toBe("5000000000000000000");
  });

  it("managed vault: no fee approve and no quote.fee when flatCreateFee is 0", async () => {
    const basket = basketRow({ vaultType: "Managed" });
    const deps = makeFeeDeps({ basket, flatCreateFee: 0n });
    const res = await buildMint(deps, VAULT, { account: ACCOUNT, units: "3" });
    // Only the constituent approve + the call — no fee approve to feeToken.
    expect(res.steps.some((s) => s.kind === "approve" && (s as unknown as { to: string }).to === FEE_TOKEN)).toBe(false);
    const q = await quoteMint(deps, VAULT, { units: "3" });
    expect(q.fee).toBeUndefined();
  });

  it("basket vault: no fee approve, no quote.fee, and NO on-chain read for the fee", async () => {
    const basket = basketRow({ vaultType: "Basket" });
    const deps = makeFeeDeps({ basket, flatCreateFee: FEE });

    const res = await buildMint(deps, VAULT, { account: ACCOUNT, units: "3" });
    expect(res.steps.some((s) => s.kind === "approve" && (s as unknown as { to: string }).to === FEE_TOKEN)).toBe(false);
    // Basket is non-share-based and has the no-op fee seam → readContract is never called.
    expect(deps.publicClient.readContract).not.toHaveBeenCalled();

    const q = await quoteMint(deps, VAULT, { units: "3" });
    expect(q.fee).toBeUndefined();
    expect(deps.publicClient.readContract).not.toHaveBeenCalled();
  });

  it("managed permit path: prepends the fee approve ahead of the sign712 steps", async () => {
    const basket = basketRow({ vaultType: "Managed" });
    const deps = makeFeeDeps({ basket, flatCreateFee: FEE });
    // Permit path also reads name/nonces/version on each constituent — extend the router.
    deps.publicClient.readContract = vi.fn(async (raw: unknown) => {
      const args = raw as { functionName: string };
      switch (args.functionName) {
        case "feeToken":
          return FEE_TOKEN;
        case "flatCreateFee":
          return FEE;
        case "name":
          return "Token A";
        case "nonces":
          return 1n;
        case "version":
          return "1";
        default:
          throw new Error(`unexpected read ${args.functionName}`);
      }
    });

    const res = await buildMintPermit(deps, VAULT, { account: ACCOUNT, units: "3" });
    const first = res.steps[0] as { kind: string; to?: string };
    expect(first.kind).toBe("approve");
    expect(first.to).toBe(FEE_TOKEN);
    expect(res.steps.some((s) => s.kind === "sign712")).toBe(true);
  });

  it("pre-flat-fee deployment: fee getters revert → fee 0, no approve, mint still builds", async () => {
    const basket = basketRow({ vaultType: "Managed" });
    const deps = makeFeeDeps({ basket, flatCreateFee: FEE });
    // An old managed impl lacks feeToken()/flatCreateFee() → the reads revert; treat as no fee.
    deps.publicClient.readContract = vi.fn(async (raw: unknown) => {
      const fn = (raw as { functionName: string }).functionName;
      if (fn === "feeToken" || fn === "flatCreateFee") throw new Error("execution reverted");
      throw new Error(`unexpected read ${fn}`);
    });

    const res = await buildMint(deps, VAULT, { account: ACCOUNT, units: "3" });
    expect(res.steps.some((s) => s.kind === "approve" && (s as unknown as { to: string }).to === FEE_TOKEN)).toBe(false);
    expect(res.steps.at(-1)!.kind).toBe("call");

    const q = await quoteMint(deps, VAULT, { units: "3" });
    expect(q.fee).toBeUndefined();
  });
});

describe("buildMint — committed vault", () => {
  // use-mint.ts: CommittedVault.create(nUnits, recipe.tokens, recipe.unitQty); recipe from constituents.
  it("encodes create(units, tokens, unitQty) with the prisma recipe", async () => {
    const basket = basketRow({
      vaultType: "Committed",
      constituents: [
        { token: TOKEN_A, unitQty: dec("1000000000000000000") },
        { token: TOKEN_B, unitQty: dec("2000000000000000000") },
      ],
    });
    const deps = makeDeps({ basket, allowances: [0n, 0n] });
    const res = await buildMint(deps, VAULT, { account: ACCOUNT, units: "3" });

    const call = res.steps.at(-1) as { kind: string; to: string; data: string; contractName: string };
    expect(call.kind).toBe("call");
    expect(call.contractName).toBe("CommittedVault");
    // Independent: create(3, [A,B], [1e18, 2e18]).
    const expected = encodeFunctionData({
      abi: CommittedVaultAbi,
      functionName: "create",
      args: [3n, [TOKEN_A, TOKEN_B], [1000000000000000000n, 2000000000000000000n]],
    });
    expect(call.data).toBe(expected);
    // two constituents under-allowed → two approves + the call.
    expect(res.steps).toHaveLength(3);
  });
});

describe("rebalance vault (share-based, previewCreate-driven)", () => {
  // FE: createArg = units * unitSize; deposits come from previewCreate(createArg) = [tokens, amounts].
  // units=2, unitSize=1e18 → createArg = 2e18.
  const preview = [
    [TOKEN_A, TOKEN_B],
    [111n, 222n],
  ] as const;

  it("quoteMint deposits/unitsOut reflect previewCreate; createArg = units*unitSize", async () => {
    const basket = basketRow({
      vaultType: "Rebalance",
      unitSize: dec("1000000000000000000"),
      constituents: [{ token: TOKEN_A, unitQty: dec("5") }], // recipe ignored for share-based
    });
    const deps = makeDeps({ basket, price: "1000000000000000000", preview });
    const q = await quoteMint(deps, VAULT, { units: "2" });

    // previewCreate called with createArg = 2 * 1e18.
    expect(deps.publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "previewCreate", args: [2000000000000000000n] }),
    );
    expect(q.deposits.map((d) => [d.token, d.amount])).toEqual([
      [TOKEN_A, "111"],
      [TOKEN_B, "222"],
    ]);
    expect(q.unitsOut).toBe("2000000000000000000");
  });

  it("buildMint approves the previewCreate amounts and encodes create(nShares)", async () => {
    const basket = basketRow({
      vaultType: "Rebalance",
      unitSize: dec("1000000000000000000"),
      constituents: [{ token: TOKEN_A, unitQty: dec("5") }],
    });
    // TOKEN_A allowance 0 (<111 → approve), TOKEN_B allowance huge (covered → no approve).
    const deps = makeDeps({ basket, allowances: [0n, 1000n], preview });
    const res = await buildMint(deps, VAULT, { account: ACCOUNT, units: "2" });

    const approves = res.steps.filter((s) => s.kind === "approve") as unknown as { to: string }[];
    expect(approves).toHaveLength(1);
    expect(approves[0]!.to).toBe(TOKEN_A);

    const call = res.steps.at(-1) as { kind: string; data: string; contractName: string };
    expect(call.contractName).toBe("ManagedRebalanceVault");
    const expected = encodeFunctionData({
      abi: ManagedRebalanceVaultAbi,
      functionName: "create",
      args: [2000000000000000000n],
    });
    expect(call.data).toBe(expected);
  });
});

describe("buildMintPermit — EIP-2612 typed data (basket vault)", () => {
  // units=3, unitQty=1e18 → deposit value = 3e18 (same FE formula as the approve path).
  const units = "3";
  const expectedAmount = "3000000000000000000";
  const NOW = 1_700_000_000;

  it("emits one sign712 step with FE-identical Permit typed data + finalize path", async () => {
    const deps = makePermitDeps({ basket: basketRow(), nonces: 7n, name: "Token A", nowSec: NOW });
    const res = await buildMintPermit(deps, VAULT, { account: ACCOUNT, units });

    expect(res.steps).toHaveLength(1);
    const step = res.steps[0] as {
      kind: string;
      token: string;
      typedData: {
        domain: { name: string; version: string; chainId: number; verifyingContract: string };
        types: Record<string, { name: string; type: string }[]>;
        primaryType: string;
        message: { owner: string; spender: string; value: string; nonce: string; deadline: string };
      };
    };

    expect(step.kind).toBe("sign712");
    expect(step.token).toBe(TOKEN_A);
    expect(step.typedData.primaryType).toBe("Permit");

    // Domain mirrors use-create-permits.ts: {name, version, chainId, verifyingContract: token}.
    expect(step.typedData.domain.verifyingContract).toBe(TOKEN_A);
    expect(step.typedData.domain.chainId).toBe(CHAIN_ID);
    expect(step.typedData.domain.name).toBe("Token A");
    expect(step.typedData.domain.version).toBe("2");

    // PERMIT_TYPES match the FE definition exactly.
    expect(step.typedData.types.Permit).toEqual([
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ]);

    // Message: owner=account, spender=vault, value=deposit amount, nonce from the read, deadline=now+3600.
    expect(step.typedData.message.owner).toBe(ACCOUNT);
    expect(step.typedData.message.spender).toBe(VAULT);
    expect(step.typedData.message.value).toBe(expectedAmount);
    expect(step.typedData.message.nonce).toBe("7");
    expect(step.typedData.message.deadline).toBe(String(NOW + 3600));

    expect(res.finalize).toEqual({ path: `/baskets/${VAULT}/tx/mint/finalize` });
  });

  it("falls back to version '1' when token.version() reverts", async () => {
    const deps = makePermitDeps({ basket: basketRow(), versionThrows: true, nowSec: NOW });
    const res = await buildMintPermit(deps, VAULT, { account: ACCOUNT, units });
    const step = res.steps[0] as { typedData: { domain: { version: string } } };
    expect(step.typedData.domain.version).toBe("1");
  });
});

describe("finalizeMintPermit — createWithPermit calldata", () => {
  it("builds one call step whose data matches independent createWithPermit encoding", async () => {
    const deps = makePermitDeps({ basket: basketRow() });
    const permits = [
      {
        token: TOKEN_A,
        value: "3000000000000000000",
        deadline: "1700003600",
        v: 27,
        r: "0x1111111111111111111111111111111111111111111111111111111111111111" as const,
        s: "0x2222222222222222222222222222222222222222222222222222222222222222" as const,
      },
    ];
    const res = await finalizeMintPermit(deps, VAULT, { account: ACCOUNT, units: "3", permits });

    expect(res.steps).toHaveLength(1);
    const call = res.steps[0] as { kind: string; to: string; data: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(VAULT);
    expect(call.needsPriorApproval).toBe(false);

    // Independent: createWithPermit(createArg=3, [{value, deadline, v, r, s}]) — struct order, no token.
    const expected = encodeFunctionData({
      abi: BasketVaultAbi,
      functionName: "createWithPermit",
      args: [
        3n,
        [
          {
            value: 3000000000000000000n,
            deadline: 1700003600n,
            v: 27,
            r: "0x1111111111111111111111111111111111111111111111111111111111111111",
            s: "0x2222222222222222222222222222222222222222222222222222222222222222",
          },
        ],
      ],
    });
    expect(call.data).toBe(expected);
    expect(res.finalize).toBeNull();
  });
});

describe("buildMintAny — chooser", () => {
  it("committed vault → approve path (no sign712)", async () => {
    const basket = basketRow({ vaultType: "Committed" });
    const deps = makeDeps({ basket, allowances: [0n] });
    const res = await buildMintAny(deps, VAULT, { account: ACCOUNT, units: "3" });
    expect(res.steps.some((s) => s.kind === "sign712")).toBe(false);
    expect(res.steps.at(-1)!.kind).toBe("call");
    expect(res.finalize).toBeNull();
  });

  it("rebalance vault → approve path (no sign712)", async () => {
    const basket = basketRow({ vaultType: "Rebalance", unitSize: dec("1000000000000000000") });
    const deps = makeDeps({
      basket,
      allowances: [0n],
      preview: [[TOKEN_A], [111n]] as const,
    });
    const res = await buildMintAny(deps, VAULT, { account: ACCOUNT, units: "2" });
    expect(res.steps.some((s) => s.kind === "sign712")).toBe(false);
    expect(res.finalize).toBeNull();
  });

  it("basket vault with permit support + default mode → permit path", async () => {
    const deps = makePermitDeps({ basket: basketRow(), nonces: 4n, nowSec: 1_700_000_000 });
    const res = await buildMintAny(deps, VAULT, { account: ACCOUNT, units: "3" });
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0]!.kind).toBe("sign712");
    expect(res.finalize).toEqual({ path: `/baskets/${VAULT}/tx/mint/finalize` });
  });

  it("basket vault with mode='approve' → approve path even when permit is supported", async () => {
    const deps = makePermitDeps({ basket: basketRow(), nonces: 4n });
    const res = await buildMintAny(deps, VAULT, { account: ACCOUNT, units: "3", mode: "approve" });
    expect(res.steps.some((s) => s.kind === "sign712")).toBe(false);
    expect(res.steps.at(-1)!.kind).toBe("call");
  });

  it("basket vault whose constituents lack nonces() → approve fallback", async () => {
    const deps = makePermitDeps({ basket: basketRow(), noncesThrows: true });
    const res = await buildMintAny(deps, VAULT, { account: ACCOUNT, units: "3" });
    expect(res.steps.some((s) => s.kind === "sign712")).toBe(false);
    expect(res.steps.at(-1)!.kind).toBe("call");
  });
});
