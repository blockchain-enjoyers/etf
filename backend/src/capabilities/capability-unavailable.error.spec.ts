import { describe, expect, it } from "vitest";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";

describe("CapabilityUnavailableError", () => {
  it("is an Error carrying the capability name and a clear message", () => {
    const err = new CapabilityUnavailableError("BasketVault");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CapabilityUnavailableError");
    expect(err.capability).toBe("BasketVault");
    expect(err.message).toMatch(/BasketVault/);
  });

  it("is catchable by its concrete type", () => {
    try {
      throw new CapabilityUnavailableError("FairValueNAV");
    } catch (e) {
      expect(e instanceof CapabilityUnavailableError).toBe(true);
    }
  });
});
