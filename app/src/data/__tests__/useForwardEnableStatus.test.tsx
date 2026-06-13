import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useForwardEnableStatus } from "../useForwardEnableStatus";

const VAULT = "0xvault1";

describe("useForwardEnableStatus", () => {
  it("returns the enable status from the API", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/baskets/${VAULT}/forward/enable/status`, () =>
        HttpResponse.json({ status: "live", queueAddress: "0xq" })
      )
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useForwardEnableStatus(VAULT, true), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.status).toBe("live");
    expect(result.current.data?.queueAddress).toBe("0xq");
  });

  it("is disabled when enabled is false", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useForwardEnableStatus(VAULT, false), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isPending).toBe(true);
  });
});
