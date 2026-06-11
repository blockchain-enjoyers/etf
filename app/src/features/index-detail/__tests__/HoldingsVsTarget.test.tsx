import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { HoldingsVsTarget } from "../HoldingsVsTarget";
import type { RebalanceDetail } from "@meridian/sdk";

const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";

const baseDetail: RebalanceDetail = {
  vaultAddress: "0xv",
  heldTokens: [{ token: TOKEN_A, balance: "5000000000000000000" }],
  target: [{ token: TOKEN_A, unitQty: "1000000000000000000" }],
  pendingTarget: null,
  lastRebalanceAtMs: null,
  drift: null,
};

describe("HoldingsVsTarget", () => {
  it("renders held balances next to target", () => {
    render(<HoldingsVsTarget detail={baseDetail} />);
    expect(screen.getByText(/Holdings vs Target/i)).toBeInTheDocument();
  });

  it("shows shortened token address", () => {
    render(<HoldingsVsTarget detail={baseDetail} />);
    expect(screen.getByText(/0x1111/i)).toBeInTheDocument();
  });

  it("shows formatted held balance and target qty", () => {
    render(<HoldingsVsTarget detail={baseDetail} />);
    // 5e18 → "5.0000", 1e18 → "1.0000"
    expect(screen.getByText("5.0000")).toBeInTheDocument();
    expect(screen.getByText("1.0000")).toBeInTheDocument();
  });

  it("shows dash for token only in held (not in target)", () => {
    const detail: RebalanceDetail = {
      ...baseDetail,
      heldTokens: [{ token: TOKEN_A, balance: "5000000000000000000" }],
      target: [{ token: TOKEN_B, unitQty: "1000000000000000000" }],
    };
    render(<HoldingsVsTarget detail={detail} />);
    // TOKEN_A has held but no target — dash in target col; TOKEN_B has target but no held — dash in held col
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("shows empty state with no holdings", () => {
    render(
      <HoldingsVsTarget
        detail={{ vaultAddress: "0xv", heldTokens: [], target: [], pendingTarget: null, lastRebalanceAtMs: null, drift: null }}
      />,
    );
    expect(screen.getByText(/no holdings/i)).toBeInTheDocument();
  });
});
