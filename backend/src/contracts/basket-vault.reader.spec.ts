import { describe, expect, it, vi } from "vitest";
import type { ChainService } from "../chain/chain.service.js";
import { BasketVaultReader } from "./basket-vault.reader.js";

const VAULT = "0x000000000000000000000000000000000000aaaa" as const;
const TOK_A = "0x000000000000000000000000000000000000000a" as const;
const TOK_B = "0x000000000000000000000000000000000000000b" as const;

function makeChain(readContract: ReturnType<typeof vi.fn>): ChainService {
  return { publicClient: { readContract } } as unknown as ChainService;
}

describe("BasketVaultReader", () => {
  it("getConstituents maps (tokens[], unitQty[]) into {token, unitQty}[]", async () => {
    const readContract = vi.fn(async () => [
      [TOK_A, TOK_B],
      [10n, 20n],
    ]);
    const reader = new BasketVaultReader(makeChain(readContract));

    const out = await reader.getConstituents(VAULT);

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: VAULT, functionName: "getConstituents" }),
    );
    expect(out).toEqual([
      { token: TOK_A, unitQty: 10n },
      { token: TOK_B, unitQty: 20n },
    ]);
  });

  it("previewCreate maps (tokens[], amounts[]) into {token, amount}[]", async () => {
    const readContract = vi.fn(async () => [
      [TOK_A, TOK_B],
      [100n, 200n],
    ]);
    const reader = new BasketVaultReader(makeChain(readContract));

    const out = await reader.previewCreate(VAULT, 5n);

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: VAULT,
        functionName: "previewCreate",
        args: [5n],
      }),
    );
    expect(out).toEqual([
      { token: TOK_A, amount: 100n },
      { token: TOK_B, amount: 200n },
    ]);
  });

  it("previewRedeem maps (tokens[], amounts[]) into {token, amount}[]", async () => {
    const readContract = vi.fn(async () => [
      [TOK_A, TOK_B],
      [1n, 2n],
    ]);
    const reader = new BasketVaultReader(makeChain(readContract));

    const out = await reader.previewRedeem(VAULT, 7n);

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: VAULT,
        functionName: "previewRedeem",
        args: [7n],
      }),
    );
    expect(out).toEqual([
      { token: TOK_A, amount: 1n },
      { token: TOK_B, amount: 2n },
    ]);
  });

  it("unitSize / totalSupply / name / symbol pass through scalar reads", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(1_000_000n) // unitSize
      .mockResolvedValueOnce(42n) // totalSupply
      .mockResolvedValueOnce("Mix Basket") // name
      .mockResolvedValueOnce("mMIX"); // symbol
    const reader = new BasketVaultReader(makeChain(readContract));

    expect(await reader.unitSize(VAULT)).toBe(1_000_000n);
    expect(await reader.totalSupply(VAULT)).toBe(42n);
    expect(await reader.name(VAULT)).toBe("Mix Basket");
    expect(await reader.symbol(VAULT)).toBe("mMIX");
  });
});
