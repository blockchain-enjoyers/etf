import { describe, it, expect } from "vitest";
import { guardForError, GATE_GUARD_IDS } from "./settle-gate-decoder.js";

describe("guardForError", () => {
  it("maps each custom error name to its guard id", () => {
    expect(guardForError("VaultNotBootstrapped")).toBe("g0");
    expect(guardForError("FeedNotSet")).toBe("g1");
    expect(guardForError("L2SourceMissing")).toBe("g1");
    expect(guardForError("NotOpen")).toBe("g2");
    expect(guardForError("NotSafe")).toBe("g3");
    expect(guardForError("InsufficientPrints")).toBe("g6");
    expect(guardForError("TwapBandBreached")).toBe("g7");
    expect(guardForError("PegStale")).toBe("g8");
    expect(guardForError("PegBreached")).toBe("g8");
  });

  it("returns undefined for an unknown error name", () => {
    expect(guardForError("HeldMismatch")).toBeUndefined();
    expect(guardForError("SomethingElse")).toBeUndefined();
  });

  it("GATE_GUARD_IDS is the ordered g0,g1,g2,g3,g6,g7,g8 set", () => {
    expect(GATE_GUARD_IDS).toEqual(["g0", "g1", "g2", "g3", "g6", "g7", "g8"]);
  });
});
