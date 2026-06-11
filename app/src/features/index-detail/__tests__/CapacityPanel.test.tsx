import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { QueueCapacity } from "@meridian/sdk";
import { CapacityPanel } from "../CapacityPanel";

function renderPanel(cap: QueueCapacity) {
  return render(<CapacityPanel capacity={cap} />);
}

describe("CapacityPanel", () => {
  it("renders 'Unlimited' when uncapped", () => {
    const cap: QueueCapacity = {
      maxCreateFlowBps: 0, windowCapShares: null, pendingCreateCash: "1000000", pendingRedeemShares: "0",
    };
    renderPanel(cap);
    expect(screen.getByText(/unlimited/i)).toBeInTheDocument();
  });

  it("renders cap (shares) + pending demand when capped", () => {
    const cap: QueueCapacity = {
      maxCreateFlowBps: 500, windowCapShares: "5000000000000000000",
      pendingCreateCash: "1000000", pendingRedeemShares: "0",
    };
    renderPanel(cap);
    expect(screen.getByText(/5 shares/i)).toBeInTheDocument();
  });

  it("shows bps + roll-over detail", () => {
    const cap: QueueCapacity = {
      maxCreateFlowBps: 500, windowCapShares: "5000000000000000000",
      pendingCreateCash: "1000000", pendingRedeemShares: "0",
    };
    renderPanel(cap);
    expect(screen.getByText(/500 bps/i)).toBeInTheDocument();
  });
});
