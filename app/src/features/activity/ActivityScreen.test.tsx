import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import type { ActivityEvent } from "@meridian/sdk";
import { ActivityScreen } from "./ActivityScreen";

function r(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const MINT: ActivityEvent = {
  vaultAddress: "0xaaaa000000000000000000000000000000000001",
  symbol: "RH5",
  owner: "0xabc",
  kind: "mint",
  payload: { nUnits: "1000000000000000000", minted: "3000000000000000000" },
  txHash: "0x1234567890abcdef1234567890abcdef12345678",
  timestampMs: 1781200000000,
};

describe("ActivityScreen", () => {
  it("renders the heading", () => {
    r(<ActivityScreen />);
    expect(screen.getByRole("heading", { name: /activity/i })).toBeInTheDocument();
  });

  it("prompts to connect a wallet when disconnected", () => {
    r(<ActivityScreen />);
    expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument();
  });

  it("shows an empty state when connected with no events", () => {
    r(<ActivityScreen connected events={[]} />);
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it("renders an activity row with action, index and amount", () => {
    r(<ActivityScreen connected events={[MINT]} />);
    expect(screen.getByText("Mint")).toBeInTheDocument();
    expect(screen.getByText("RH5")).toBeInTheDocument();
    expect(screen.getByText(/\+3\.0000 RH5/)).toBeInTheDocument();
  });
});
