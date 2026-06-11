import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaultKindPicker } from "./VaultKindPicker";

describe("VaultKindPicker", () => {
  it("renders all four kinds and marks the selected one", () => {
    render(<VaultKindPicker value="basket" onChange={vi.fn()} />);
    for (const label of [/static/i, /managed/i, /committed/i, /rebalanced/i]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: /static/i })).toBeChecked();
  });

  it("calls onChange with the kind when a card is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VaultKindPicker value="basket" onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: /rebalanced/i }));
    expect(onChange).toHaveBeenCalledWith("rebalance");
  });

  it("shows a fee badge only on managed and rebalanced cards", () => {
    render(<VaultKindPicker value="basket" onChange={vi.fn()} />);
    // exactly two cards carry the "manager fee" badge
    const feeCards = screen
      .getAllByRole("radio")
      .filter((card) => within(card).queryAllByText(/manager fee/i).length > 0);
    expect(feeCards).toHaveLength(2);
  });
});
