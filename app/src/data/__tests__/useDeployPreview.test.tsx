import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw-server";
import { makeWrapper, TEST_BASE_URL } from "./wrapper";
import { useDeployPreview } from "../useDeployPreview";

const req = {
  account: "0xo", vaultKind: "basket" as const, name: "X", symbol: "X",
  tokens: ["0xA"], unitSize: "1000", composition: { mode: "quantities" as const, qty: ["50"] },
};

describe("useDeployPreview", () => {
  it("posts the request and returns the preview", async () => {
    server.use(http.post(`${TEST_BASE_URL}/tx/preview-deploy`, () => HttpResponse.json({
      unitQty: ["50000000000000000000"], breakdown: [], totalValueUsd: "0", priceMissing: [],
      predictedVault: "0xVault", gate: { gated: false, reason: "none" },
    })));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeployPreview(req), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.predictedVault).toBe("0xVault");
  });

  it("is disabled when there are no valid tokens", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeployPreview({ ...req, tokens: [] }), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
