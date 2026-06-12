import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepSettings } from "./StepSettings";
import { initialState } from "./reducer";
import type { WizardState } from "./types";

function state(over: Partial<WizardState> = {}): WizardState {
  return { ...initialState(), ...over };
}

describe("StepSettings — fee consistency", () => {
  it("basket shows no manager-fee and no keeper module", () => {
    render(<StepSettings state={state({ vaultKind: "basket" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.queryByLabelText(/manager fee/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/keeper cut/i)).not.toBeInTheDocument();
  });
  it("committed shows no fee module", () => {
    render(<StepSettings state={state({ vaultKind: "committed" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.queryByLabelText(/manager fee/i)).not.toBeInTheDocument();
  });
  it("managed shows manager fee but not keeper", () => {
    render(<StepSettings state={state({ vaultKind: "managed" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByLabelText(/manager fee/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/keeper cut/i)).not.toBeInTheDocument();
  });
  it("rebalance shows manager fee + keeper cut", () => {
    render(<StepSettings state={state({ vaultKind: "rebalance" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByLabelText(/manager fee/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/keeper cut/i)).toBeInTheDocument();
  });
  it("registry mirrors rebalance: manager fee + keeper cut + platform AUM disclosure", () => {
    render(<StepSettings state={state({ vaultKind: "registry" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByLabelText(/manager fee/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/keeper cut/i)).toBeInTheDocument();
    expect(screen.getByText(/platform aum fee/i)).toBeInTheDocument();
  });
  it("the zero-flow-fee note keeps the 0% flow headline and shows 'no other fees' for basket", () => {
    render(<StepSettings state={state({ vaultKind: "basket" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getAllByText(/0%/).length).toBeGreaterThan(0);
    expect(screen.getByText(/no other fees/i)).toBeInTheDocument();
    // basket must NOT imply an ongoing platform AUM fee.
    expect(screen.queryByText(/platform aum fee/i)).not.toBeInTheDocument();
  });

  it("managed discloses the ongoing manager + platform AUM + flat fees (not '0% total')", () => {
    render(<StepSettings state={state({ vaultKind: "managed" })} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/platform aum fee/i)).toBeInTheDocument();
    expect(screen.getByText(/ongoing fees/i)).toBeInTheDocument();
  });
});
