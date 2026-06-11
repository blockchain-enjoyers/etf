import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useForwardTickets } from "../useForwardTickets";
import { useForwardQueue } from "../useForwardQueue";
import { useSettleGateStatus } from "../useSettleGateStatus";
import { useForwardHistory } from "../useForwardHistory";

const VAULT = "0xvault1";

describe("useForwardTickets", () => {
  it("returns tickets, appends ?owner", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/forward/tickets`, ({ request }) => {
        const owner = new URL(request.url).searchParams.get("owner");
        return HttpResponse.json(
          owner
            ? [{ id: 0, vaultAddress: VAULT, owner, kind: "create", amountRaw: "1000000",
                remainingRaw: "1000000", status: "pending", cutoffMs: 1, createdAtMs: 0 }]
            : [],
        );
      }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useForwardTickets(VAULT, "0xme", true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.owner).toBe("0xme");
  });

  it("is disabled when enabled is false", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useForwardTickets(VAULT, undefined, false), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useForwardQueue", () => {
  it("returns queue + capacity", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/forward/queue`, () =>
        HttpResponse.json({
          queueAddress: "0xq", tickets: [],
          capacity: { maxCreateFlowBps: 0, windowCapShares: null, pendingCreateCash: "0", pendingRedeemShares: "0" },
        }),
      ),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useForwardQueue(VAULT, true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.queueAddress).toBe("0xq");
  });
});

describe("useSettleGateStatus", () => {
  it("returns gate with estimated true", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/forward/gate`, () =>
        HttpResponse.json({ open: false, navPerShare: null, twap: null, guards: [], estimated: true }),
      ),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSettleGateStatus(VAULT, true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.estimated).toBe(true);
  });
});

describe("useForwardHistory", () => {
  it("returns history items", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/forward/history`, () =>
        HttpResponse.json({ items: [{ kind: "Settled", id: 1, txHash: "0xh", timestampMs: 1, payload: {} }] }),
      ),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useForwardHistory(VAULT, true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.kind).toBe("Settled");
  });
});
