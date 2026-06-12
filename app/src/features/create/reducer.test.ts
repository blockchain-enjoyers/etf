import { describe, it, expect } from "vitest";
import {
  initialState, wizardReducer, weightSum, weightsBalanced,
  isRowValid, hasDuplicateAddresses, validConstituents, constituentsOk, sortedValidConstituents,
} from "./reducer";
import type { WizardState } from "./types";
import { isWeightsMode, isManagedRebalance } from "./types";

const A = "0x" + "1".repeat(40);
const B = "0x" + "2".repeat(40);

function withConstituents(rows: { token: string; amount: string }[], over: Partial<WizardState> = {}): WizardState {
  return { ...initialState(), constituents: rows.map((r, i) => ({ id: String(i), ...r })), ...over };
}

describe("initialState", () => {
  it("defaults to a basket with one empty row and a notional", () => {
    const s = initialState();
    expect(s.vaultKind).toBe("basket");
    expect(s.constituents).toHaveLength(1);
    expect(s.valuePerUnitUsd).toBe("1000");
    expect(s.creationUnitSize).toBe("1000");
  });
});

describe("wizardReducer", () => {
  it("SET_VAULT_KIND switches kind", () => {
    const s = wizardReducer(initialState(), { type: "SET_VAULT_KIND", value: "rebalance" });
    expect(s.vaultKind).toBe("rebalance");
  });
  it("LOAD_TEMPLATE sets the kind and replaces constituents with the template rows", () => {
    const s = wizardReducer(initialState(), {
      type: "LOAD_TEMPLATE",
      vaultKind: "basket",
      rows: [{ token: A, amount: "60.00" }, { token: B, amount: "40.00" }],
    });
    expect(s.vaultKind).toBe("basket");
    expect(s.constituents).toHaveLength(2);
    expect(s.constituents.map((c) => [c.token, c.amount])).toEqual([[A, "60.00"], [B, "40.00"]]);
    // Fresh ids assigned per row.
    expect(new Set(s.constituents.map((c) => c.id)).size).toBe(2);
  });
  it("LOAD_TEMPLATE with no rows keeps existing constituents (kind still applied)", () => {
    const s0 = withConstituents([{ token: A, amount: "1" }]);
    const s = wizardReducer(s0, { type: "LOAD_TEMPLATE", vaultKind: "registry", rows: [] });
    expect(s.vaultKind).toBe("registry");
    expect(s.constituents).toEqual(s0.constituents);
  });
  it("UPDATE_CONSTITUENT edits the amount field", () => {
    const s0 = initialState();
    const id = s0.constituents[0]!.id;
    const s = wizardReducer(s0, { type: "UPDATE_CONSTITUENT", id, field: "amount", value: "50" });
    expect(s.constituents[0]!.amount).toBe("50");
  });
  it("SET_VALUE_PER_UNIT updates the notional", () => {
    const s = wizardReducer(initialState(), { type: "SET_VALUE_PER_UNIT", value: "2500" });
    expect(s.valuePerUnitUsd).toBe("2500");
  });
  it("SET_SYMBOL uppercases and caps at 8 chars", () => {
    const s = wizardReducer(initialState(), { type: "SET_SYMBOL", value: "techindex" });
    expect(s.symbol).toBe("TECHINDE");
  });
});

describe("validation", () => {
  it("weightSum sums the amount column", () => {
    expect(weightSum(withConstituents([{ token: A, amount: "40" }, { token: B, amount: "60" }]).constituents)).toBe(100);
  });
  it("weightsBalanced is true only at 100 (±0.05)", () => {
    expect(weightsBalanced(withConstituents([{ token: A, amount: "40" }, { token: B, amount: "60" }]).constituents)).toBe(true);
    expect(weightsBalanced(withConstituents([{ token: A, amount: "40" }, { token: B, amount: "50" }]).constituents)).toBe(false);
  });
  it("quantities mode: constituentsOk needs no 100% sum", () => {
    const s = withConstituents([{ token: A, amount: "50" }, { token: B, amount: "30" }], { vaultKind: "basket" });
    expect(constituentsOk(s)).toBe(true);
  });
  it("weights mode: constituentsOk requires Σ=100 and a positive notional", () => {
    const ok = withConstituents([{ token: A, amount: "40" }, { token: B, amount: "60" }], { vaultKind: "rebalance", valuePerUnitUsd: "1000" });
    expect(constituentsOk(ok)).toBe(true);
    const offSum = withConstituents([{ token: A, amount: "40" }, { token: B, amount: "50" }], { vaultKind: "rebalance", valuePerUnitUsd: "1000" });
    expect(constituentsOk(offSum)).toBe(false);
    const noNotional = withConstituents([{ token: A, amount: "40" }, { token: B, amount: "60" }], { vaultKind: "rebalance", valuePerUnitUsd: "0" });
    expect(constituentsOk(noNotional)).toBe(false);
  });
  it("registry mirrors rebalance: weights mode + managed-rebalance profile, Σ=100 gate applies", () => {
    expect(isWeightsMode("registry")).toBe(true);
    expect(isManagedRebalance("registry")).toBe(true);
    const ok = withConstituents([{ token: A, amount: "40" }, { token: B, amount: "60" }], { vaultKind: "registry", valuePerUnitUsd: "1000" });
    expect(constituentsOk(ok)).toBe(true);
    const offSum = withConstituents([{ token: A, amount: "40" }, { token: B, amount: "50" }], { vaultKind: "registry", valuePerUnitUsd: "1000" });
    expect(constituentsOk(offSum)).toBe(false);
  });
  it("rejects duplicate token addresses", () => {
    expect(hasDuplicateAddresses(withConstituents([{ token: A, amount: "1" }, { token: A, amount: "1" }]).constituents)).toBe(true);
  });
  it("isRowValid needs a 0x address and a positive amount", () => {
    expect(isRowValid({ id: "x", token: A, amount: "1" })).toBe(true);
    expect(isRowValid({ id: "x", token: "nope", amount: "1" })).toBe(false);
    expect(isRowValid({ id: "x", token: A, amount: "0" })).toBe(false);
    expect(validConstituents(withConstituents([{ token: A, amount: "1" }, { token: "", amount: "" }]).constituents)).toHaveLength(1);
  });

  it("sortedValidConstituents sorts valid rows by token address ascending (on-chain recipe invariant)", () => {
    const hi = "0x" + "f".repeat(40);
    const lo = "0x" + "1".repeat(40);
    const rows = [
      { id: "1", token: hi, amount: "1" },
      { id: "2", token: lo, amount: "2" },
      { id: "3", token: "", amount: "" }, // dropped (invalid)
    ];
    expect(sortedValidConstituents(rows).map((c) => c.token)).toEqual([lo, hi]);
  });
});
