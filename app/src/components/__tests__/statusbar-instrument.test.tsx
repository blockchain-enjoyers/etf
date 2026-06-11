import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBar } from "../StatusBar";
import { InstrumentBar, type InstrumentStat } from "../InstrumentBar";

function renderBar(stats?: InstrumentStat[]) {
  return render(
    <InstrumentBar
      symbol="RHV"
      name="Robinhood Volatility 5"
      navLabel="$1,402.65"
      typeLabel="Rebalance"
      marketStatus="regular"
      estimated={false}
      stats={stats}
    />,
  );
}

describe("StatusBar", () => {
  it("renders chain + market segments", () => {
    render(<StatusBar marketStatus="regular" />);
    expect(screen.getByText(/Robinhood Chain/i)).toBeInTheDocument();
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });

  it("says Open for regular market (shared label map)", () => {
    render(<StatusBar marketStatus="regular" />);
    expect(screen.getByText("Open")).toBeInTheDocument();
  });
});

describe("InstrumentBar", () => {
  it("renders ticker, name and NAV", () => {
    renderBar();
    expect(screen.getByText("RHV")).toBeInTheDocument();
    expect(screen.getByText("$1,402.65")).toBeInTheDocument();
  });

  it("renders all stats", () => {
    renderBar([
      { k: "Your holding", v: "3 RHV" },
      { k: "Premium", v: "+0.31%" },
    ]);
    expect(screen.getByText("Your holding")).toBeInTheDocument();
    expect(screen.getByText("3 RHV")).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(screen.getByText("+0.31%")).toBeInTheDocument();
  });
});
