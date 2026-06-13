import { describe, it, expect } from "vitest";
import { paramsHash, buildEnableCashSettlementTypedData } from "./eip712.js";
import type { EnableParams } from "./dto.js";

const params: EnableParams = {
  minPrints: 2,
  twapWindowSec: 600,
  twapBandBps: 200,
  pegBandBps: 200,
  pegMaxAgeSec: 3600,
  cutoffDelaySec: 600,
  spreadBps: 0,
  capacityBps: 0,
  keeperTip: "0",
  keeperBps: 0,
};
// This MUST equal the backend `paramsHashOf(params)` for the identical fixture (same 10×uint256 ABI encoding).
const CANONICAL_HASH = "0xcb98f0b7906c1848fb03c18b86681c1123d0bac4aa27be638251085e18404729";

describe("eip712", () => {
  it("paramsHash matches the backend canonical hash (cross-package determinism)", () => {
    expect(paramsHash(params)).toBe(CANONICAL_HASH);
  });
  it("paramsHash is deterministic", () => {
    expect(paramsHash(params)).toBe(paramsHash(params));
  });
  it("buildEnableCashSettlementTypedData wires domain + message", () => {
    const td = buildEnableCashSettlementTypedData(
      "0x000000000000000000000000000000000000bEEF",
      params,
      1n,
      9999n,
      46630,
    );
    expect(td.domain).toEqual({
      name: "Meridian",
      version: "1",
      chainId: 46630,
      verifyingContract: "0x000000000000000000000000000000000000bEEF",
    });
    expect(td.primaryType).toBe("EnableCashSettlement");
    expect(td.message.paramsHash).toBe(CANONICAL_HASH);
    expect(td.message.nonce).toBe(1n);
    expect(td.message.expiry).toBe(9999n);
  });
});
