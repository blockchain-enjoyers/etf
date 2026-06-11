import { describe, expect, it, vi } from "vitest";
import type { BasketVaultReader } from "../../contracts/basket-vault.reader.js";
import { CapabilityUnavailableError } from "../capability-unavailable.error.js";
import { LiveCreateQuoteAdapter } from "./create-quote.live.adapter.js";
import { MockCreateQuoteAdapter } from "./create-quote.mock.adapter.js";
import { NullCreateQuoteAdapter } from "./create-quote.null.adapter.js";

const VAULT = "0x000000000000000000000000000000000000aaaa" as const;
const TOK_A = "0x000000000000000000000000000000000000000a" as const;
const TOK_B = "0x000000000000000000000000000000000000000b" as const;

describe("CreateQuote adapters", () => {
  it("live delegates to BasketVaultReader.previewCreate", async () => {
    const previewCreate = vi.fn(async () => [
      { token: TOK_A, amount: 100n },
      { token: TOK_B, amount: 200n },
    ]);
    const reader = { previewCreate } as unknown as BasketVaultReader;
    const prisma = {
      basket: { findUnique: vi.fn().mockResolvedValue({ vaultType: "Basket", constituents: [] }) },
    };
    const adapter = new LiveCreateQuoteAdapter(reader, prisma as never);

    const out = await adapter.quote(VAULT, 5n);

    expect(previewCreate).toHaveBeenCalledWith(VAULT, 5n);
    expect(out).toEqual([
      { token: TOK_A, amount: 100n },
      { token: TOK_B, amount: 200n },
    ]);
  });

  it("committed vault: amounts are unitQty*nUnits from the indexed recipe (no previewCreate)", async () => {
    const prisma = {
      basket: {
        findUnique: vi.fn().mockResolvedValue({
          vaultType: "Committed",
          constituents: [{ token: "0xt1", unitQty: "10" }, { token: "0xt2", unitQty: "20" }],
        }),
      },
    };
    const vault = { previewCreate: vi.fn() };
    const adapter = new LiveCreateQuoteAdapter(vault as never, prisma as never);
    const out = await adapter.quote("0xVault", 3n);
    expect(vault.previewCreate).not.toHaveBeenCalled();
    expect(out).toEqual([
      { token: "0xt1", amount: 30n },
      { token: "0xt2", amount: 60n },
    ]);
  });

  it("null throws CapabilityUnavailableError (iron rule: never fall back)", async () => {
    const adapter = new NullCreateQuoteAdapter();
    await expect(adapter.quote(VAULT, 5n)).rejects.toBeInstanceOf(CapabilityUnavailableError);
    await expect(adapter.quote(VAULT, 5n)).rejects.toThrow(/BasketVault/);
  });

  it("mock returns its seeded quote", async () => {
    const seeded = [{ token: TOK_A, amount: 3n }];
    const adapter = new MockCreateQuoteAdapter(seeded);
    expect(await adapter.quote(VAULT, 1n)).toEqual(seeded);
  });
});
