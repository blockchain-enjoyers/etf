import { describe, expect, it, vi } from "vitest";
import type { BasketVaultReader } from "../../contracts/basket-vault.reader.js";
import { CapabilityUnavailableError } from "../capability-unavailable.error.js";
import { LiveRedeemQuoteAdapter } from "./redeem-quote.live.adapter.js";
import { MockRedeemQuoteAdapter } from "./redeem-quote.mock.adapter.js";
import { NullRedeemQuoteAdapter } from "./redeem-quote.null.adapter.js";

const VAULT = "0x000000000000000000000000000000000000aaaa" as const;
const TOK_A = "0x000000000000000000000000000000000000000a" as const;
const TOK_B = "0x000000000000000000000000000000000000000b" as const;

describe("RedeemQuote adapters", () => {
  it("live delegates to BasketVaultReader.previewRedeem", async () => {
    const previewRedeem = vi.fn(async () => [
      { token: TOK_A, amount: 1n },
      { token: TOK_B, amount: 2n },
    ]);
    const reader = { previewRedeem } as unknown as BasketVaultReader;
    const prisma = {
      basket: {
        findUnique: vi.fn().mockResolvedValue({ vaultType: "Basket", constituents: [] }),
      },
    };
    const chain = { publicClient: { readContract: vi.fn() } };
    const adapter = new LiveRedeemQuoteAdapter(reader, prisma as never, chain as never);

    const out = await adapter.quote(VAULT, 7n);

    expect(previewRedeem).toHaveBeenCalledWith(VAULT, 7n);
    expect(out).toEqual([
      { token: TOK_A, amount: 1n },
      { token: TOK_B, amount: 2n },
    ]);
  });

  it("committed vault: pro-rata from on-chain balances (no previewRedeem)", async () => {
    const prisma = {
      basket: {
        findUnique: vi.fn().mockResolvedValue({
          vaultType: "Committed",
          constituents: [{ token: "0xt1" }, { token: "0xt2" }],
        }),
      },
    };
    const chain = {
      publicClient: {
        readContract: vi.fn()
          .mockResolvedValueOnce(100n)   // totalSupply
          .mockResolvedValueOnce(1000n)  // balanceOf t1
          .mockResolvedValueOnce(2000n), // balanceOf t2
      },
    };
    const vault = { previewRedeem: vi.fn() };
    const adapter = new LiveRedeemQuoteAdapter(vault as never, prisma as never, chain as never);
    const out = await adapter.quote("0xVault", 10n);
    expect(vault.previewRedeem).not.toHaveBeenCalled();
    expect(out).toEqual([
      { token: "0xt1", amount: 100n },  // 1000*10/100
      { token: "0xt2", amount: 200n },  // 2000*10/100
    ]);
  });

  it("null throws CapabilityUnavailableError (iron rule: never fall back)", async () => {
    const adapter = new NullRedeemQuoteAdapter();
    await expect(adapter.quote(VAULT, 7n)).rejects.toBeInstanceOf(CapabilityUnavailableError);
    await expect(adapter.quote(VAULT, 7n)).rejects.toThrow(/BasketVault/);
  });

  it("mock returns its seeded quote", async () => {
    const seeded = [{ token: TOK_A, amount: 9n }];
    const adapter = new MockRedeemQuoteAdapter(seeded);
    expect(await adapter.quote(VAULT, 1n)).toEqual(seeded);
  });
});
