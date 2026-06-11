import { describe, expect, it } from "vitest";
import { assertTxPlanSafe } from "./tx-guard.js";
import type { TxPlan } from "./dto.js";

const plan = (to: string): TxPlan => ({
  chainId: 46630, gate: { gated: false, reason: "none" }, finalize: null,
  steps: [{ kind: "call", to, data: "0x", value: "0", contractName: "BasketVault", label: "Mint", summary: "", simulated: true }],
});

describe("assertTxPlanSafe", () => {
  const ctx = { addressBook: { basketvault: "0xVAULT" }, constituentTokens: ["0xTSLA"] };

  it("passes when `to` is a known contract (case-insensitive)", () => {
    expect(() => assertTxPlanSafe(plan("0xVAULT"), ctx)).not.toThrow();
    expect(() => assertTxPlanSafe(plan("0xvault"), ctx)).not.toThrow();
  });

  it("passes when `to` is a constituent token (approve)", () => {
    expect(() => assertTxPlanSafe(plan("0xTSLA"), ctx)).not.toThrow();
  });

  it("throws when `to` is unknown", () => {
    expect(() => assertTxPlanSafe(plan("0xEVIL"), ctx)).toThrow(/unknown destination/i);
  });

  it("ignores sign712 steps (no `to`)", () => {
    const p: TxPlan = { ...plan("0xVAULT"), steps: [{ kind: "sign712", token: "0xA", label: "", summary: "",
      typedData: { domain: { name: "A", version: "1", chainId: 46630, verifyingContract: "0x000000000000000000000000000000000000000A" },
        types: { Permit: [] }, primaryType: "Permit", message: { owner: "0x0000000000000000000000000000000000000001", spender: "0x0000000000000000000000000000000000000002", value: "1", nonce: "0", deadline: "9" } } }] };
    expect(() => assertTxPlanSafe(p, ctx)).not.toThrow();
  });
});
