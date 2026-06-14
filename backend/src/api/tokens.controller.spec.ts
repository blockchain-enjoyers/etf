import { describe, expect, it, vi } from "vitest";
import { demoTokens } from "@meridian/contracts";
import { TokensController } from "./tokens.controller.js";
import type { TokenMetadataService } from "../contracts/token-metadata.service.js";
import type { ChainService } from "../chain/chain.service.js";

const NVDA = demoTokens.find((t) => t.symbol === "NVDA")!;

function make(getMany = vi.fn().mockResolvedValue({}), readContract = vi.fn(), usdg?: string) {
  const meta = { getMany } as unknown as TokenMetadataService;
  const chain = { publicClient: { readContract } } as unknown as ChainService;
  const registry = { address: (c: string) => (c === "USDG" ? usdg : undefined) } as never;
  return { ctrl: new TokensController(meta, chain, registry), getMany, readContract };
}

describe("TokensController.search", () => {
  it("returns rows including NVDA for query 'NV'", () => {
    const { ctrl } = make();
    const out = ctrl.search("NV");
    expect(out.some((r) => r.symbol === "NVDA")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
    const hit = out.find((r) => r.symbol === "NVDA")!;
    expect(hit.token).toBe(NVDA.address);
    expect(hit.name).toBe(NVDA.name);
  });

  it("returns [] for a blank query", () => {
    const { ctrl } = make();
    expect(ctrl.search("   ")).toEqual([]);
    expect(ctrl.search(undefined)).toEqual([]);
  });
});

describe("TokensController.resolve", () => {
  it("maps a known demoTokens address to its symbol without calling getMany", async () => {
    const { ctrl, getMany } = make();
    const out = await ctrl.resolve({ addresses: [NVDA.address.toUpperCase()] });
    expect(out).toEqual([{ token: NVDA.address, symbol: NVDA.symbol, name: NVDA.name }]);
    expect(getMany).not.toHaveBeenCalled();
  });

  it("falls back to getMany for an unknown address", async () => {
    const unknown = "0x000000000000000000000000000000000000dead";
    const getMany = vi.fn().mockResolvedValue({
      [unknown]: { token: unknown, symbol: "WHO", name: "Mystery", decimals: 18 },
    });
    const { ctrl } = make(getMany);
    const out = await ctrl.resolve({ addresses: [unknown] });
    expect(getMany).toHaveBeenCalledWith([unknown]);
    expect(out).toEqual([{ token: unknown, symbol: "WHO", name: "Mystery" }]);
  });

  it("preserves input order across known + unknown addresses", async () => {
    const unknown = "0x000000000000000000000000000000000000beef";
    const getMany = vi.fn().mockResolvedValue({ [unknown]: { token: unknown, symbol: "BEEF", name: null, decimals: 18 } });
    const { ctrl } = make(getMany);
    const out = await ctrl.resolve({ addresses: [unknown, NVDA.address] });
    expect(out.map((r) => r.symbol)).toEqual(["BEEF", "NVDA"]);
  });
});

describe("TokensController.balances", () => {
  const ACC = "0x000000000000000000000000000000000000aaaa";

  it("returns balance + faucet headroom for a faucet token", async () => {
    const getMany = vi.fn().mockResolvedValue({ [NVDA.address.toLowerCase()]: { symbol: "NVDA", decimals: 18 } });
    // balanceOf, then FAUCET_AMOUNT, FAUCET_CAP, faucetMinted.
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(5n * 10n ** 18n) // balanceOf
      .mockResolvedValueOnce(100n * 10n ** 18n) // FAUCET_AMOUNT
      .mockResolvedValueOnce(100n * 10n ** 18n) // FAUCET_CAP
      .mockResolvedValueOnce(0n); // faucetMinted
    const { ctrl } = make(getMany, readContract);
    const out = await ctrl.balances({ account: ACC, tokens: [NVDA.address] });
    expect(out).toEqual([
      {
        token: NVDA.address,
        symbol: "NVDA",
        decimals: 18,
        balance: (5n * 10n ** 18n).toString(),
        faucetAmount: (100n * 10n ** 18n).toString(),
        faucetRemaining: (100n * 10n ** 18n).toString(),
      },
    ]);
  });

  it("reports null faucet for a non-faucet token (getters revert)", async () => {
    const getMany = vi.fn().mockResolvedValue({ [NVDA.address.toLowerCase()]: { symbol: "NVDA", decimals: 18 } });
    const readContract = vi.fn(async (req: { functionName: string }) => {
      if (req.functionName === "balanceOf") return 1n;
      throw new Error("no faucet");
    });
    const { ctrl } = make(getMany, readContract);
    const out = await ctrl.balances({ account: ACC, tokens: [NVDA.address] });
    expect(out[0]!.faucetAmount).toBeNull();
    expect(out[0]!.faucetRemaining).toBeNull();
    expect(out[0]!.balance).toBe("1");
  });

  it("returns [] when account or tokens are empty", async () => {
    const { ctrl } = make();
    expect(await ctrl.balances({ account: "", tokens: [NVDA.address] })).toEqual([]);
    expect(await ctrl.balances({ account: ACC, tokens: [] })).toEqual([]);
  });

  it("reports an open-mint USDG faucet (fixed amount, unlimited headroom) without reading getters", async () => {
    const USDG = "0x000000000000000000000000000000000000d6c0";
    const getMany = vi.fn().mockResolvedValue({ [USDG]: { symbol: "USDG", decimals: 18 } });
    const readContract = vi.fn(async (req: { functionName: string }) => {
      if (req.functionName === "balanceOf") return 7n * 10n ** 18n;
      throw new Error("USDG has no faucet getters");
    });
    const { ctrl } = make(getMany, readContract, USDG);
    const out = await ctrl.balances({ account: ACC, tokens: [USDG] });
    expect(out[0]!.faucetAmount).toBe((100n * 10n ** 18n).toString());
    expect(BigInt(out[0]!.faucetRemaining!)).toBeGreaterThan(0n);
    expect(out[0]!.balance).toBe((7n * 10n ** 18n).toString());
  });
});
