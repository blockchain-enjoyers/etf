import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTabs, type WorkspaceId } from "../WorkspaceTabs";

const TABS = [
  { id: "trade" as WorkspaceId, label: "Trade", who: "Buy · Sell · Redeem", role: "holder" as const },
  { id: "liquidity" as WorkspaceId, label: "Liquidity", who: "Forward cash", role: "ap" as const },
];

describe("WorkspaceTabs", () => {
  it("marks the active tab pressed", () => {
    render(<WorkspaceTabs tabs={TABS} active="trade" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /Trade/ })).toHaveAttribute("aria-selected", "true");
  });
  it("calls onChange when another tab is clicked", async () => {
    const onChange = vi.fn();
    render(<WorkspaceTabs tabs={TABS} active="trade" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: /Liquidity/ }));
    expect(onChange).toHaveBeenCalledWith("liquidity");
  });
  it("shows the prefixed audience pill in each tab", () => {
    render(<WorkspaceTabs tabs={TABS} active="trade" onChange={() => {}} />);
    expect(screen.getByText("For: Holder / Investor")).toBeInTheDocument();
    expect(screen.getByText("For: Authorized Participant")).toBeInTheDocument();
  });
});
