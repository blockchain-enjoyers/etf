import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { SettleGateStatus } from "@meridian/sdk";
import { SettleReadinessPanel } from "../SettleReadinessPanel";

const gate: SettleGateStatus = {
  open: false,
  navPerShare: null,
  twap: "1050000000000000000",
  guards: [
    { id: "g0", ok: true, reason: null },
    { id: "g2", ok: false, reason: "NotOpen" },
  ],
  estimated: true,
};

describe("SettleReadinessPanel", () => {
  it("renders the decision-only banner and each guard with its reason", () => {
    render(<SettleReadinessPanel gate={gate} />);
    expect(screen.getByText(/decision-only/i)).toBeInTheDocument();
    expect(screen.getByText("g0")).toBeInTheDocument();
    expect(screen.getByText("g2")).toBeInTheDocument();
    expect(screen.getByText(/NotOpen/)).toBeInTheDocument();
  });

  it("renders an estimate label for navPerShare", () => {
    render(<SettleReadinessPanel gate={{ ...gate, open: true, navPerShare: "1000000000000000000" }} />);
    expect(screen.getByLabelText(/estimated/i)).toBeInTheDocument();
  });
});
