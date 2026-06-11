import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepType } from "./StepType";
import { initialState } from "./reducer";

describe("StepType", () => {
  it("dispatches SET_VAULT_KIND when a card is chosen", async () => {
    const dispatch = vi.fn();
    const user = userEvent.setup();
    render(<StepType state={initialState()} dispatch={dispatch} onBack={vi.fn()} onNext={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: /rebalanced/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_VAULT_KIND", value: "rebalance" });
  });

  it("has a How do I choose button (modal arrives in P6)", () => {
    render(<StepType state={initialState()} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /how do i choose/i })).toBeInTheDocument();
  });

  it("Next is always enabled (a kind is always selected)", () => {
    render(<StepType state={initialState()} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });
});
