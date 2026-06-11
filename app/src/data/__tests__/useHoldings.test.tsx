import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useHoldings } from "../useHoldings";

const VAULT = "0xvault1";

const holdingsPayload = {
  vaultAddress: VAULT,
  navPerUnit: "1000000000000000000",
  estimated: false,
  timestampMs: 1700000000000,
  holdings: [
    {
      token: "0xtoken",
      symbol: "AAPL",
      name: "Apple Inc.",
      decimals: 18,
      qtyPerUnit: "1.0",
      priceUsd: "150.0",
      valuePerUnitUsd: "150.0",
      currentWeightBps: 10000,
      targetWeightBps: 10000,
      driftBps: 0,
      estimated: false,
    },
  ],
};

describe("useHoldings", () => {
  it("returns holdings from the API", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/holdings`, () =>
        HttpResponse.json(holdingsPayload)
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useHoldings(VAULT), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.vaultAddress).toBe(VAULT);
    expect(result.current.data?.estimated).toBe(false);
    expect(result.current.data?.holdings).toHaveLength(1);
    expect(result.current.data?.holdings[0]?.symbol).toBe("AAPL");
  });

  it("is disabled when vaultAddress is empty", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useHoldings(""), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});
