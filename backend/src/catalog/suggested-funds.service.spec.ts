import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileSync = vi.fn<(p: string, enc: string) => string>();
vi.mock("node:fs", () => ({ readFileSync: (p: string, enc: string) => readFileSync(p, enc) }));

// Import after the mock is registered.
const { SuggestedFundsService } = await import("./suggested-funds.service.js");

const RESOLVABLE_A = "0xaaaa000000000000000000000000000000000001";
const RESOLVABLE_B = "0xbbbb000000000000000000000000000000000002";
const FOREIGN = "0xcccc000000000000000000000000000000000003";

const fixtureCatalog = {
  schema_version: "2.0",
  funds: [
    {
      id: "sp500",
      name: "S&P 500",
      description: "SPY replica.",
      theme: "broad market",
      coverage_pct: 94.85,
      constituent_count: 442,
      vault: { type: "RegistryRebalanceVault" },
      // 8 constituents → exercises the SAMPLE_CAP of 6.
      constituents: Array.from({ length: 8 }, (_, i) => ({
        ticker: `T${i}`,
        weight_pct: 1.5,
        address: `0x${String(i).repeat(40).slice(0, 40)}`,
      })),
    },
    {
      id: "dow30",
      name: "Dow Jones 30",
      description: "DIA replica.",
      theme: "broad market",
      coverage_pct: 88.0,
      constituent_count: 3,
      vault: { type: "BasketVault" },
      constituents: [
        { ticker: "AAA", weight_pct: 40, address: RESOLVABLE_A.toUpperCase() },
        { ticker: "BBB", weight_pct: 35, address: RESOLVABLE_B },
        { ticker: "CCC", weight_pct: 25, address: FOREIGN },
      ],
    },
    {
      id: "lonely",
      name: "Lonely",
      description: "Only one resolvable name.",
      theme: "sector",
      constituent_count: 2,
      vault: { type: "CommittedVault" },
      constituents: [
        { ticker: "AAA", weight_pct: 50, address: RESOLVABLE_A },
        { ticker: "CCC", weight_pct: 50, address: FOREIGN },
      ],
    },
  ],
};

function makeConfig(over: Partial<{ path: string | undefined; tokens: string }> = {}) {
  const map: Record<string, unknown> = {
    SUGGESTED_FUNDS_PATH: "path" in over ? over.path : undefined,
    SUGGESTED_FUNDS_TOKENS: over.tokens ?? "[]",
  };
  return { get: vi.fn((k: string) => map[k]) } as never;
}

describe("SuggestedFundsService", () => {
  beforeEach(() => {
    readFileSync.mockReset();
    readFileSync.mockReturnValue(JSON.stringify(fixtureCatalog));
  });

  it("shapes funds, maps the vault kind, caps the sample, and keeps the full holdingsCount", () => {
    const svc = new SuggestedFundsService(makeConfig());
    const { funds } = svc.get();

    expect(funds).toHaveLength(3);
    const sp = funds.find((f) => f.id === "sp500")!;
    expect(sp.recommendedVaultKind).toBe("registry");
    expect(sp.category).toBe("broad market");
    expect(sp.coveragePct).toBe(94.85);
    expect(sp.holdingsCount).toBe(442);
    // Capped to the top 6 for display even though 8 constituents exist.
    expect(sp.sampleHoldings).toHaveLength(6);
    expect(sp.sampleHoldings[0]!.weightBps).toBe(150); // 1.5% → 150 bps
  });

  it("maps every catalog vault type onto the FE VaultKind enum", () => {
    const svc = new SuggestedFundsService(makeConfig());
    const { funds } = svc.get();
    expect(funds.find((f) => f.id === "dow30")!.recommendedVaultKind).toBe("basket");
    expect(funds.find((f) => f.id === "lonely")!.recommendedVaultKind).toBe("committed");
  });

  it("marks funds reference-only (no resolvable tokens) when the allowlist is empty", () => {
    const svc = new SuggestedFundsService(makeConfig());
    for (const f of svc.get().funds) expect(f.resolvableTokens).toHaveLength(0);
  });

  it("resolves the subset whose address is in the allowlist (case-insensitive) for pre-fill", () => {
    const svc = new SuggestedFundsService(
      makeConfig({ tokens: JSON.stringify([RESOLVABLE_A, RESOLVABLE_B]) }),
    );
    const dow = svc.get().funds.find((f) => f.id === "dow30")!;
    expect(dow.resolvableTokens.map((t) => t.symbol)).toEqual(["AAA", "BBB"]);
    expect(dow.resolvableTokens[0]!.token).toBe(RESOLVABLE_A); // lowercased
    expect(dow.resolvableTokens[0]!.weightBps).toBe(4000);
  });

  it("drops resolvability below the 2-constituent minimum (a single resolvable name is not enough)", () => {
    const svc = new SuggestedFundsService(makeConfig({ tokens: JSON.stringify([RESOLVABLE_A]) }));
    expect(svc.get().funds.find((f) => f.id === "lonely")!.resolvableTokens).toHaveLength(0);
  });

  it("caches: the file is read at most once across repeated calls", () => {
    const svc = new SuggestedFundsService(makeConfig());
    svc.get();
    svc.get();
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("serves an empty catalog (no throw) when the file is missing everywhere", () => {
    readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const svc = new SuggestedFundsService(makeConfig());
    expect(svc.get().funds).toEqual([]);
  });

  it("prefers a configured SUGGESTED_FUNDS_PATH", () => {
    const svc = new SuggestedFundsService(makeConfig({ path: "/custom/suggested_funds.json" }));
    svc.get();
    expect(readFileSync.mock.calls[0]![0]).toContain("suggested_funds.json");
  });
});
