import { describe, it, expect } from "vitest";
import { ApiError, CapabilityUnavailableError } from "./errors.js";

describe("ApiError", () => {
  it("sets status and message", () => {
    const err = new ApiError(404, "not found");
    expect(err.status).toBe(404);
    expect(err.message).toBe("not found");
    expect(err.name).toBe("ApiError");
    expect(err).toBeInstanceOf(Error);
  });

  it("is instanceof ApiError", () => {
    expect(new ApiError(500, "oops")).toBeInstanceOf(ApiError);
  });
});

describe("CapabilityUnavailableError", () => {
  it("uses default message", () => {
    const err = new CapabilityUnavailableError();
    expect(err.message).toBe("Capability unavailable");
    expect(err.name).toBe("CapabilityUnavailableError");
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts a custom message", () => {
    const err = new CapabilityUnavailableError("no oracle");
    expect(err.message).toBe("no oracle");
  });
});
