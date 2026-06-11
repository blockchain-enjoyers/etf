import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RebalanceHistory } from "../RebalanceHistory";
import type { RebalanceHistory as RebalanceHistoryType } from "@meridian/sdk";

const RECIPIENT = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";
const TX_HASH = "0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe";

const historyWithItems: RebalanceHistoryType = {
  items: [
    {
      txHash: TX_HASH,
      blockNumber: 42000,
      recipient: RECIPIENT,
      acquire: [{ token: TOKEN_A, amount: "3000000000000000000" }],
      release: [{ token: TOKEN_B, amount: "1000000000000000000" }],
      timestampMs: 1700000000000,
    },
  ],
};

const historyEmpty: RebalanceHistoryType = { items: [] };

describe("RebalanceHistory", () => {
  it("renders Rebalance history section header", () => {
    render(<RebalanceHistory history={historyWithItems} />);
    expect(screen.getByText(/Rebalance history/i)).toBeInTheDocument();
  });

  it("shows acquire token address (shortened)", () => {
    render(<RebalanceHistory history={historyWithItems} />);
    expect(screen.getByText(/0x1111/i)).toBeInTheDocument();
  });

  it("shows release token address (shortened)", () => {
    render(<RebalanceHistory history={historyWithItems} />);
    expect(screen.getByText(/0x2222/i)).toBeInTheDocument();
  });

  it("shows recipient address (shortened)", () => {
    render(<RebalanceHistory history={historyWithItems} />);
    expect(screen.getByText(/0xBBBB/i)).toBeInTheDocument();
  });

  it("renders tx link to explorer", () => {
    render(<RebalanceHistory history={historyWithItems} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining(TX_HASH));
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows empty state when no items", () => {
    render(<RebalanceHistory history={historyEmpty} />);
    expect(screen.getByText(/no rebalances yet/i)).toBeInTheDocument();
  });
});
