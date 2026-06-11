import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useMintQuote } from "../useMintQuote";

const VAULT = "0xvault1";

const mintQuotePayload = {
  unitsOut: "1000000000000000000",
  deposits: [
    {
      token: "0xtoken",
      symbol: "AAPL",
      amount: "150.0",
      valueUsd: "150.0",
    },
  ],
  estTotalUsd: "150.0",
  gate: { gated: false, reason: "none" },
};

describe("useMintQuote", () => {
  it("returns a mint quote from the API", async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/baskets/${VAULT}/mint-quote`, () =>
        HttpResponse.json(mintQuotePayload)
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useMintQuote(VAULT, "1000000000000000000"),
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.unitsOut).toBe("1000000000000000000");
    expect(result.current.data?.deposits).toHaveLength(1);
    expect(result.current.data?.gate.gated).toBe(false);
  });

  it("is disabled when vaultAddress is empty", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMintQuote("", "1000000000000000000"), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });

  it("is disabled when units is zero", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMintQuote(VAULT, "0"), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });

  it("is disabled when units is empty string", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMintQuote(VAULT, ""), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });

  it("is disabled when units is not a valid BigInt", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useMintQuote(VAULT, "not-a-number"), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});
