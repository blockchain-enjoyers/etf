import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { BasketVaultReader } from "../contracts/basket-vault.reader.js";
import { CapabilityRegistry } from "../contracts/capability-registry.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";
import { CreateQuotePort } from "./create-quote/create-quote.port.js";
import { LiveCreateQuoteAdapter } from "./create-quote/create-quote.live.adapter.js";
import { NullCreateQuoteAdapter } from "./create-quote/create-quote.null.adapter.js";
import { LiveRedeemQuoteAdapter } from "./redeem-quote/redeem-quote.live.adapter.js";
import { NullRedeemQuoteAdapter } from "./redeem-quote/redeem-quote.null.adapter.js";
import { RedeemQuotePort } from "./redeem-quote/redeem-quote.port.js";

const VAULT = "0x000000000000000000000000000000000000aaaa" as const;
const TOK_A = "0x000000000000000000000000000000000000000a" as const;

function buildModule(status: "live" | "absent") {
  const registry = { status: vi.fn(() => status) } as unknown as CapabilityRegistry;
  const vaultReader = {
    previewRedeem: vi.fn(async () => [{ token: TOK_A, amount: 1n }]),
    previewCreate: vi.fn(async () => [{ token: TOK_A, amount: 2n }]),
  } as unknown as BasketVaultReader;
  const prisma = {
    basket: { findUnique: vi.fn().mockResolvedValue({ vaultType: "Basket", constituents: [] }) },
  };
  const chain = { publicClient: { readContract: vi.fn() } };

  return Test.createTestingModule({
    providers: [
      { provide: CapabilityRegistry, useValue: registry },
      { provide: BasketVaultReader, useValue: vaultReader },
      {
        provide: RedeemQuotePort,
        useFactory: (reg: CapabilityRegistry, vault: BasketVaultReader): RedeemQuotePort =>
          reg.status("BasketVault") === "live"
            ? new LiveRedeemQuoteAdapter(vault, prisma as never, chain as never)
            : new NullRedeemQuoteAdapter(),
        inject: [CapabilityRegistry, BasketVaultReader],
      },
      {
        provide: CreateQuotePort,
        useFactory: (reg: CapabilityRegistry, vault: BasketVaultReader): CreateQuotePort =>
          reg.status("BasketVault") === "live"
            ? new LiveCreateQuoteAdapter(vault, prisma as never)
            : new NullCreateQuoteAdapter(),
        inject: [CapabilityRegistry, BasketVaultReader],
      },
    ],
  }).compile();
}

describe("CapabilitiesModule binding", () => {
  it("binds the LIVE quote adapters when BasketVault status is live", async () => {
    const moduleRef = await buildModule("live");

    const redeem = moduleRef.get(RedeemQuotePort);
    const create = moduleRef.get(CreateQuotePort);

    expect(redeem).toBeInstanceOf(LiveRedeemQuoteAdapter);
    expect(create).toBeInstanceOf(LiveCreateQuoteAdapter);
    expect(await redeem.quote(VAULT, 7n)).toEqual([{ token: TOK_A, amount: 1n }]);
    expect(await create.quote(VAULT, 5n)).toEqual([{ token: TOK_A, amount: 2n }]);
  });

  it("binds the NULL quote adapters when BasketVault status is absent", async () => {
    const moduleRef = await buildModule("absent");

    const redeem = moduleRef.get(RedeemQuotePort);
    const create = moduleRef.get(CreateQuotePort);

    expect(redeem).toBeInstanceOf(NullRedeemQuoteAdapter);
    expect(create).toBeInstanceOf(NullCreateQuoteAdapter);
    await expect(redeem.quote(VAULT, 7n)).rejects.toBeInstanceOf(CapabilityUnavailableError);
    await expect(create.quote(VAULT, 5n)).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });
});
