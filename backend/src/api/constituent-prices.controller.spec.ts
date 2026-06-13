import { describe, it, expect, vi } from "vitest";
import { ConstituentPricesController } from "./constituent-prices.controller.js";

const TA = "0x000000000000000000000000000000000000000a" as `0x${string}`;
const TB = "0x000000000000000000000000000000000000000b" as `0x${string}`;

function ctrl(overrides: {
  rebVault?: Record<string, unknown>;
  chain?: Record<string, unknown>;
  registry?: Record<string, unknown>;
  aggSourcePayloads?: Record<string, unknown>;
} = {}) {
  const rebVault = {
    heldTokens: vi.fn(async () => [TA, TB]),
    ...overrides.rebVault,
  };
  const chain = {
    publicClient: {
      readContract: vi.fn(async () => 3n),
      simulateContract: vi.fn(async () => ({ result: { price: 100n, safe: true } })),
    },
    account: undefined,
    ...overrides.chain,
  };
  const registry = { address: (cap: string) => (cap === "PriceAggregator" ? "0xagg" : undefined), ...overrides.registry };
  const aggSourcePayloads = {
    payloadsFor: vi.fn(async (tokens: `0x${string}`[]) => tokens.map(() => ["0x"])),
    ...overrides.aggSourcePayloads,
  };
  return new ConstituentPricesController(
    rebVault as never,
    registry as never,
    chain as never,
    aggSourcePayloads as never,
  );
}

describe("ConstituentPricesController", () => {
  it("returns one row per held token with median price + sourceCount", async () => {
    const rows = await ctrl().getConstituentPrices("0xv");
    expect(rows).toEqual([
      { token: TA, price: "100", sourceCount: 3 },
      { token: TB, price: "100", sourceCount: 3 },
    ]);
  });

  it("caps to the first 12 held tokens", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
    );
    const rows = await ctrl({ rebVault: { heldTokens: vi.fn(async () => many) } }).getConstituentPrices("0xv");
    expect(rows).toHaveLength(12);
    expect(rows[0]!.token).toBe(many[0]);
  });

  it("returns a row with price 0 when priceOf reverts, keeping sourceCount", async () => {
    const simulateContract = vi.fn(async () => {
      throw new Error("NoSources");
    });
    const readContract = vi.fn(async () => 1n);
    const rows = await ctrl({
      rebVault: { heldTokens: vi.fn(async () => [TA]) },
      chain: { publicClient: { readContract, simulateContract }, account: undefined },
    }).getConstituentPrices("0xv");
    expect(rows).toEqual([{ token: TA, price: "0", sourceCount: 1 }]);
  });

  it("returns [] when the PriceAggregator capability is absent", async () => {
    const rows = await ctrl({ registry: { address: () => undefined } }).getConstituentPrices("0xv");
    expect(rows).toEqual([]);
  });
});
