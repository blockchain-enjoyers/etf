import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepConstituents } from "./StepConstituents";
import { initialState } from "./reducer";
import type { WizardState } from "./types";

function state(over: Partial<WizardState> = {}): WizardState {
  return { ...initialState(), ...over };
}
const A = "0x" + "1".repeat(40);
const B = "0x" + "2".repeat(40);
function withRows(rows: { token: string; amount: string }[], over: Partial<WizardState> = {}): WizardState {
  return state({ constituents: rows.map((r, i) => ({ id: String(i), ...r })), ...over });
}

describe("StepConstituents — quantities mode (basket)", () => {
  it("labels the amount column 'Qty / unit' and has no 100% gate", () => {
    render(<StepConstituents state={withRows([{ token: A, amount: "50" }, { token: B, amount: "30" }], { vaultKind: "basket" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/qty \/ unit/i)).toBeInTheDocument();
    expect(screen.queryByText(/value \/ creation unit/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });
  it("disables Next with no valid rows", () => {
    render(<StepConstituents state={withRows([{ token: "", amount: "" }], { vaultKind: "basket" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });
  it("shows — (not 0.0%) for an unpriced token's ≈ weight in quantities mode", () => {
    render(
      <StepConstituents
        state={withRows([{ token: A, amount: "5" }], { vaultKind: "basket" })}
        dispatch={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
        preview={{ breakdown: [{ token: A, qty: "5", weightBps: 0, valueUsd: "0" }], priceMissing: [] }}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });
});

describe("StepConstituents — weights mode (rebalance)", () => {
  it("labels the amount column 'Target %', shows the value-per-unit input and a Σ indicator", () => {
    render(<StepConstituents state={withRows([{ token: A, amount: "40" }, { token: B, amount: "60" }], { vaultKind: "rebalance" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/target %/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/value \/ creation unit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weight sum/i)).toHaveTextContent("100");
  });
  it("disables Next when Σ ≠ 100", () => {
    render(<StepConstituents state={withRows([{ token: A, amount: "40" }, { token: B, amount: "50" }], { vaultKind: "rebalance" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });
  it("edits an amount via dispatch", async () => {
    const dispatch = vi.fn();
    const user = userEvent.setup();
    // Empty amount so a single keystroke yields a deterministic value with a stubbed dispatch
    // (controlled input never reflects back through vi.fn()).
    render(<StepConstituents state={withRows([{ token: A, amount: "" }], { vaultKind: "rebalance" })} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} />);
    const input = screen.getByLabelText("Asset 1 amount");
    await user.type(input, "5");
    expect(dispatch).toHaveBeenCalledWith({ type: "UPDATE_CONSTITUENT", id: "0", field: "amount", value: "5" });
  });

  it("renders the derived → qty from the preview in weights mode", () => {
    render(
      <StepConstituents
        state={{ ...initialState(), vaultKind: "rebalance", constituents: [{ id: "0", token: A, amount: "100" }] }}
        dispatch={() => {}}
        onBack={() => {}}
        onNext={() => {}}
        preview={{ breakdown: [{ token: A, qty: "4.0", weightBps: 10000 }], priceMissing: [] }}
      />,
    );
    expect(screen.getByText("4.0")).toBeInTheDocument();
  });
});
