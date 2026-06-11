import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useAvailability } from "../useAvailability";

const VAULT = "0xvault1";
const ACCOUNT = "0xaccount1";

const availabilityPayload = {
  vaultAddress: VAULT,
  account: null,
  items: [
    { action: "mint", enabled: true, reason: "ok" },
    { action: "redeemInKind", enabled: true, reason: "ok" },
  ],
};

describe("useAvailability", () => {
  it("returns availability without account", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/availability`, ({ request }) => {
        const account = new URL(request.url).searchParams.get("account");
        return HttpResponse.json({ ...availabilityPayload, account });
      })
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAvailability(VAULT), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.vaultAddress).toBe(VAULT);
    expect(result.current.data?.items).toHaveLength(2);
    expect(result.current.data?.items[0]?.action).toBe("mint");
  });

  it("appends ?account= when provided", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/availability`, ({ request }) => {
        const account = new URL(request.url).searchParams.get("account");
        return HttpResponse.json({ ...availabilityPayload, account });
      })
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAvailability(VAULT, ACCOUNT), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.account).toBe(ACCOUNT);
  });

  it("is disabled when vaultAddress is empty", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useAvailability(""), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});
