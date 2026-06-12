import { describe, expect, it, vi } from "vitest";
import { CatalogController } from "./catalog.controller.js";
import type { SuggestedFundsService } from "./suggested-funds.service.js";

describe("CatalogController", () => {
  it("returns the shaped catalog from the service", () => {
    const response = {
      funds: [
        {
          id: "sp500",
          name: "S&P 500",
          category: "broad market",
          recommendedVaultKind: "registry" as const,
          description: "SPY.",
          sampleHoldings: [{ symbol: "NVDA", weightBps: 842, address: "0xnvda" }],
          holdingsCount: 442,
          resolvableTokens: [],
        },
      ],
    };
    const service = { get: vi.fn().mockReturnValue(response) } as unknown as SuggestedFundsService;
    const controller = new CatalogController(service);
    expect(controller.suggestedFundsCatalog()).toBe(response);
    expect(service.get).toHaveBeenCalledOnce();
  });
});
