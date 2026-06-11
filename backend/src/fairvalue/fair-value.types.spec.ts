import { describe, expect, it } from "vitest";
import {
  FAIR_VALUE_EIP712_TYPES,
  fairValueDomain,
  toFairValueMessage,
} from "./fair-value.types.js";

describe("fair-value typed data", () => {
  it("builds an EIP-712 domain pinned to the RHC chain id", () => {
    const domain = fairValueDomain(46630, "0x00000000000000000000000000000000000000aa");
    expect(domain.chainId).toBe(46630);
    expect(domain.name).toBe("MeridianFairValue");
    expect(domain.version).toBe("1");
    expect(domain.verifyingContract).toBe("0x00000000000000000000000000000000000000aa");
  });

  it("maps a FairValue into the typed-data message with bigint base units", () => {
    const msg = toFairValueMessage({
      basketId: "0xbeef",
      nav: 1_000000000000000000n,
      lower: 990000000000000000n,
      upper: 1010000000000000000n,
      timestamp: 1_700_000_000,
    });
    expect(msg.nav).toBe(1_000000000000000000n);
    expect(msg.timestamp).toBe(1_700_000_000n);
    expect(FAIR_VALUE_EIP712_TYPES.FairValue.length).toBe(5);
  });
});
