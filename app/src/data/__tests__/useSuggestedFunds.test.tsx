import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useSuggestedFunds } from "../useSuggestedFunds";

const payload = {
  funds: [
    {
      id: "sp500",
      name: "S&P 500",
      category: "broad market",
      recommendedVaultKind: "registry",
      description: "SPY.",
      sampleHoldings: [{ symbol: "NVDA", weightBps: 842, address: "0xnvda" }],
      holdingsCount: 442,
      coveragePct: 94.85,
      resolvableTokens: [],
    },
  ],
};

describe("useSuggestedFunds", () => {
  it("returns the catalog from /catalog/suggested-funds", async () => {
    server.use(http.get(`${TEST_BASE_URL}/catalog/suggested-funds`, () => HttpResponse.json(payload)));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSuggestedFunds(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.funds).toHaveLength(1);
    expect(result.current.data?.funds[0]?.recommendedVaultKind).toBe("registry");
  });
});
