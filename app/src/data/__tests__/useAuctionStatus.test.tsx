import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useAuctionStatus } from "../useAuctionStatus";

const VAULT = "0xvault1";
const ACCOUNT = "0xaccount1";

const auctionPayload = {
  vaultAddress: VAULT,
  deployed: true,
  execMode: 0,
  openAllow: false,
  acquireIn: [],
};

describe("useAuctionStatus", () => {
  it("returns auction status without account", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/auction`, () => {
        return HttpResponse.json(auctionPayload);
      })
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAuctionStatus(VAULT), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.vaultAddress).toBe(VAULT);
    expect(result.current.data?.deployed).toBe(true);
    expect(result.current.data?.execMode).toBe(0);
  });

  it("appends ?account= when provided", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/auction`, ({ request }) => {
        const account = new URL(request.url).searchParams.get("account");
        return HttpResponse.json({ ...auctionPayload, openAllow: account === ACCOUNT });
      })
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAuctionStatus(VAULT, ACCOUNT), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.openAllow).toBe(true);
  });

  it("is disabled when vaultAddress is empty", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAuctionStatus(""), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});
