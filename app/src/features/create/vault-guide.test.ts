import { describe, it, expect } from "vitest";
import { CREATE_HELP } from "./help-content";
import { COMPARISON, QUESTIONS } from "./vault-guide";

describe("create help content", () => {
  it("has help for every keyed field", () => {
    for (const k of ["name", "symbol", "token", "qtyPerUnit", "targetPct", "valuePerUnit", "creationUnit", "managerFee", "keeperCut", "keeperEscrow", "kind.basket", "kind.managed", "kind.committed", "kind.rebalance", "kind.registry"]) {
      expect(CREATE_HELP[k]?.brief, k).toBeTruthy();
    }
  });
  it("comparison table covers all five kinds per row", () => {
    expect(COMPARISON.length).toBeGreaterThan(0);
    for (const r of COMPARISON) {
      expect(r.basket && r.managed && r.committed && r.rebalance && r.registry).toBeTruthy();
    }
  });
  it("every guide question maps options to real kinds", () => {
    const kinds = new Set(["basket", "managed", "committed", "rebalance", "registry"]);
    for (const q of QUESTIONS) for (const o of q.options) expect(kinds.has(o.kind)).toBe(true);
  });
});
