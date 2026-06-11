import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { HoldingsTable } from "../HoldingsTable";
import type { HoldingRow } from "@meridian/sdk";

const row: HoldingRow = {
  token: "0x1111111111111111111111111111111111111111",
  symbol: "AAPL",
  name: "Apple Inc.",
  decimals: 18,
  qtyPerUnit: "500000000000000000",
  priceUsd: "180000000000000000000",
  valuePerUnitUsd: "90000000000000000000",
  currentWeightBps: 5000,
  targetWeightBps: 5000,
  driftBps: 0,
  estimated: false,
};

describe("HoldingsTable", () => {
  it("renders data-testid", () => {
    render(<HoldingsTable rows={[row]} />);
    expect(screen.getByTestId("holdings-table")).toBeInTheDocument();
  });

  it("renders a row per entry plus header", () => {
    render(<HoldingsTable rows={[row]} />);
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("renders the symbol", () => {
    render(<HoldingsTable rows={[row]} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("renders the formatted USD value", () => {
    render(<HoldingsTable rows={[row]} />);
    expect(screen.getByText("$90.00")).toBeInTheDocument();
  });

  it("renders empty table with no rows", () => {
    render(<HoldingsTable rows={[]} />);
    expect(screen.getByTestId("holdings-table")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});
