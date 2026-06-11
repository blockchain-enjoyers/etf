import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { KeeperPanel } from "../KeeperPanel";
import type { KeeperStatus } from "@meridian/sdk";

const KEEPER_ADDR = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TX_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

const keeperWithPayouts: KeeperStatus = {
  escrow: "2500000000000000000",
  keeperBps: 50,
  payouts: [
    {
      to: KEEPER_ADDR,
      amount: "100000000000000000",
      txHash: TX_HASH,
      timestampMs: 1700000000000,
    },
  ],
};

const keeperEmpty: KeeperStatus = {
  escrow: "0",
  keeperBps: 10,
  payouts: [],
};

describe("KeeperPanel", () => {
  it("renders Keeper section header", () => {
    render(<KeeperPanel keeper={keeperWithPayouts} />);
    expect(screen.getByText(/Keeper/i)).toBeInTheDocument();
  });

  it("shows formatted escrow amount", () => {
    render(<KeeperPanel keeper={keeperWithPayouts} />);
    // 2.5e18 → "2.5000 shares"
    expect(screen.getByText(/2\.5000/)).toBeInTheDocument();
  });

  it("shows keeper bps", () => {
    render(<KeeperPanel keeper={keeperWithPayouts} />);
    expect(screen.getByText(/50\s*bps/)).toBeInTheDocument();
  });

  it("shows shortened payout address", () => {
    render(<KeeperPanel keeper={keeperWithPayouts} />);
    expect(screen.getByText(/0xAAAA/i)).toBeInTheDocument();
  });

  it("renders tx link to explorer", () => {
    render(<KeeperPanel keeper={keeperWithPayouts} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining(TX_HASH));
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows empty state when no payouts", () => {
    render(<KeeperPanel keeper={keeperEmpty} />);
    expect(screen.getByText(/no keeper payouts/i)).toBeInTheDocument();
  });
});
