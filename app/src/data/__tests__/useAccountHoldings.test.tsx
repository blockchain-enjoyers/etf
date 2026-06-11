import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useAccountHoldings } from "../useAccountHoldings";

const ACCOUNT = "0xaccount1";

const accountHoldingsPayload = {
  account: ACCOUNT,
  holdings: [
    {
      vaultAddress: "0xvault1",
      symbol: "TBTK",
      balance: "5000000000000000000",
      valueUsd: "5000.0",
      estimated: false,
    },
  ],
};

describe("useAccountHoldings", () => {
  it("returns account holdings from the API", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/accounts/${ACCOUNT}/holdings`, () =>
        HttpResponse.json(accountHoldingsPayload)
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAccountHoldings(ACCOUNT), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.account).toBe(ACCOUNT);
    expect(result.current.data?.holdings).toHaveLength(1);
    expect(result.current.data?.holdings[0]?.symbol).toBe("TBTK");
  });

  it("is disabled when account is undefined", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAccountHoldings(undefined), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});
