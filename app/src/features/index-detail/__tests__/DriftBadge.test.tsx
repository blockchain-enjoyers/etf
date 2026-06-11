import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DriftBadge } from "../DriftBadge";
import type { RebalanceDetail } from "@meridian/sdk";

type Drift = RebalanceDetail["drift"];

describe("DriftBadge", () => {
  it("shows no-data copy when drift is null", () => {
    render(<DriftBadge drift={null} />);
    expect(screen.getByText(/—|no drift data/i)).toBeInTheDocument();
    expect(screen.queryByText(/rebalance due/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/within band/i)).not.toBeInTheDocument();
  });

  it("shows 'Rebalance due' when drift.isDue is true", () => {
    const drift: Drift = {
      isDue: true,
      triggerBandBps: 500,
      items: [{ token: "0x1", driftBps: 750 }],
    };
    render(<DriftBadge drift={drift} />);
    expect(screen.getByText(/rebalance due/i)).toBeInTheDocument();
  });

  it("shows 'Within band' when drift.isDue is false", () => {
    const drift: Drift = {
      isDue: false,
      triggerBandBps: 500,
      items: [{ token: "0x1", driftBps: 120 }],
    };
    render(<DriftBadge drift={drift} />);
    expect(screen.getByText(/within band/i)).toBeInTheDocument();
  });
});
