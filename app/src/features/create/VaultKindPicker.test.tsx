import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaultKindPicker } from "./VaultKindPicker";

describe("VaultKindPicker", () => {
  it("renders the four offered kinds (committed hidden) and marks the selected one", () => {
    render(<VaultKindPicker value="basket" onChange={vi.fn()} />);
    for (const label of [/^static$/i, /managed fee/i, /^rebalanced$/i, /index fund/i]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("radio", { name: /committed/i })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^static$/i })).toBeChecked();
  });

  it("calls onChange with 'registry' when the Index fund card is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VaultKindPicker value="basket" onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: /index fund/i }));
    expect(onChange).toHaveBeenCalledWith("registry");
  });

  it("calls onChange with the kind when a card is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VaultKindPicker value="basket" onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: /rebalanced/i }));
    expect(onChange).toHaveBeenCalledWith("rebalance");
  });

  it("shows a Management fee badge on managed and rebalanced cards", () => {
    render(<VaultKindPicker value="basket" onChange={vi.fn()} />);
    const feeCards = screen
      .getAllByRole("radio")
      .filter((card) => within(card).queryAllByText(/management fee/i).length > 0);
    expect(feeCards).toHaveLength(2);
  });
});
