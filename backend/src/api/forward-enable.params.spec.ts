import { describe, it, expect } from "vitest";
import { validateEnableParams, paramsHashOf, type EnableParams } from "./forward-enable.params.js";
const ok: EnableParams = { minPrints: 2, twapWindowSec: 600, twapBandBps: 200, pegBandBps: 200, pegMaxAgeSec: 3600, cutoffDelaySec: 600, spreadBps: 0, capacityBps: 0, keeperTip: "0", keeperBps: 0 };
describe("enable params", () => {
  it("accepts a valid set", () => { expect(validateEnableParams(ok)).toEqual({ ok: true }); });
  it("rejects keeperBps over KEEPER_MAX", () => { expect(validateEnableParams({ ...ok, keeperBps: 2001 })).toEqual({ ok: false, field: "keeperBps" }); });
  it("rejects cutoffDelay below MIN", () => { expect(validateEnableParams({ ...ok, cutoffDelaySec: 599 })).toEqual({ ok: false, field: "cutoffDelaySec" }); });
  it("paramsHashOf is deterministic + 0x+64hex", () => { const h = paramsHashOf(ok); expect(h).toMatch(/^0x[0-9a-f]{64}$/); expect(paramsHashOf(ok)).toBe(h); });
});
