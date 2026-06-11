import { describe, it, expect } from "vitest";
import { NullForwardRecordWriter } from "./forward-record-writer.null.adapter.js";
import { NullForwardSettleWriter } from "./forward-settle-writer.null.adapter.js";
import { CapabilityUnavailableError } from "./capability-unavailable.error.js";

describe("null forward writers", () => {
  it("record throws CapabilityUnavailableError", async () => {
    await expect(new NullForwardRecordWriter().record("0xv")).rejects.toBeInstanceOf(
      CapabilityUnavailableError,
    );
  });
  it("settle throws CapabilityUnavailableError", async () => {
    await expect(
      new NullForwardSettleWriter().settle("0xv", [0n], "0xap"),
    ).rejects.toBeInstanceOf(CapabilityUnavailableError);
  });
});
