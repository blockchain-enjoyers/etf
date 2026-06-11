import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { CapabilityUnavailableError } from "@meridian/sdk";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useFeed } from "../useFeed";
import { useNav } from "../useNav";
import { useRedeemQuote } from "../useRedeemQuote";
import { useRebalanceDetail } from "../useRebalanceDetail";
import { useKeeperStatus } from "../useKeeperStatus";
import { useRebalanceHistory } from "../useRebalanceHistory";

const VAULT = "0xvault1";

const feedPayload = {
  items: [
    {
      vaultAddress: VAULT,
      symbol: "TBTK",
      nav: "1000000000000000000",
      estimated: false,
      marketStatus: "regular",
      timestampMs: 1700000000000,
    },
  ],
};

const navPayload = {
  vaultAddress: VAULT,
  nav: "999000000000000000",
  confidenceLower: "990000000000000000",
  confidenceUpper: "1010000000000000000",
  marketStatus: "closed",
  estimated: true,
  source: "chainlink",
  timestampMs: 1700000000000,
};

describe("useFeed", () => {
  it("returns feed items from the API", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/feed`, () => HttpResponse.json(feedPayload))
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFeed(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const items = result.current.data?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.vaultAddress).toBe(VAULT);
  });

  it("surfaces API errors", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/feed`, () =>
        HttpResponse.json({ message: "server error" }, { status: 500 })
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFeed(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect((result.current.error as Error).message).toBeTruthy();
  });
});

describe("useNav", () => {
  it("returns estimated:true for a closed-market fixture", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/nav`, () =>
        HttpResponse.json(navPayload)
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useNav(VAULT), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.estimated).toBe(true);
    expect(result.current.data?.marketStatus).toBe("closed");
    expect(result.current.data?.nav).toBe("999000000000000000");
  });

  it("is disabled when vaultAddress is empty", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useNav(""), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});

describe("useRedeemQuote", () => {
  it("returns a successful quote", async () => {
    const quoteResponse = {
      assets: [{ token: "0xtoken", amount: "500000000000000000" }],
      gateState: { gated: false, reason: "none" },
    };

    server.use(
      http.post(`${TEST_BASE_URL}/baskets/${VAULT}/redeem-quote`, () =>
        HttpResponse.json(quoteResponse)
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRedeemQuote(VAULT), {
      wrapper: Wrapper,
    });

    result.current.mutate({ basketTokenAmount: "1000000000000000000" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.assets).toHaveLength(1);
    expect(result.current.data?.gateState.gated).toBe(false);
  });

  it("surfaces a 503 as CapabilityUnavailableError", async () => {
    server.use(
      http.post(`${TEST_BASE_URL}/baskets/${VAULT}/redeem-quote`, () =>
        new HttpResponse(null, { status: 503 })
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRedeemQuote(VAULT), {
      wrapper: Wrapper,
    });

    result.current.mutate({ basketTokenAmount: "1000000000000000000" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(CapabilityUnavailableError);
  });
});

describe("useRebalanceDetail", () => {
  const rebalancePayload = {
    vaultAddress: VAULT,
    heldTokens: [{ token: "0xtoken", balance: "500.0" }],
    target: [{ token: "0xtoken", unitQty: "1.0" }],
    pendingTarget: null,
    lastRebalanceAtMs: null,
    drift: null,
  };

  it("returns rebalance detail from the API", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/rebalance`, () =>
        HttpResponse.json(rebalancePayload)
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRebalanceDetail(VAULT, true), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.vaultAddress).toBe(VAULT);
    expect(result.current.data?.drift).toBeNull();
  });

  it("is disabled when enabled is false", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRebalanceDetail(VAULT, false), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});

describe("useKeeperStatus", () => {
  const keeperPayload = {
    escrow: "1000.0",
    keeperBps: 10,
    payouts: [],
  };

  it("returns keeper status from the API", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/keeper`, () =>
        HttpResponse.json(keeperPayload)
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useKeeperStatus(VAULT, true), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.keeperBps).toBe(10);
    expect(result.current.data?.payouts).toHaveLength(0);
  });

  it("is disabled when enabled is false", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useKeeperStatus(VAULT, false), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});

describe("useRebalanceHistory", () => {
  const historyPayload = {
    items: [
      {
        txHash: "0xabc",
        blockNumber: 1000,
        recipient: "0xrecipient",
        acquire: [{ token: "0xtoken", amount: "100.0" }],
        release: [],
        timestampMs: 1700000000000,
      },
    ],
  };

  it("returns rebalance history from the API", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/rebalance/history`, () =>
        HttpResponse.json(historyPayload)
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRebalanceHistory(VAULT, true), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.items).toHaveLength(1);
    expect(result.current.data?.items[0]?.txHash).toBe("0xabc");
  });

  it("is disabled when enabled is false", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useRebalanceHistory(VAULT, false), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});
