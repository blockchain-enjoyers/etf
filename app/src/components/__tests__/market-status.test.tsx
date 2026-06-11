import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketStatusWidget } from "../MarketStatusWidget";

describe("MarketStatusWidget", () => {
  it("renders Open for regular status", () => {
    render(<MarketStatusWidget status="regular" />);
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("renders Closed for closed status", () => {
    render(<MarketStatusWidget status="closed" />);
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  it("renders Pre-market label", () => {
    render(<MarketStatusWidget status="preMarket" />);
    expect(screen.getByText("Pre-market")).toBeTruthy();
  });

  it("shows ~est when estimated is true", () => {
    render(<MarketStatusWidget status="closed" estimated />);
    expect(screen.getByText("~est")).toBeTruthy();
  });

  it("does not show ~est when estimated is false", () => {
    render(<MarketStatusWidget status="regular" estimated={false} />);
    expect(screen.queryByText("~est")).toBeNull();
  });

  it("has aria-label with status", () => {
    render(<MarketStatusWidget status="regular" />);
    expect(screen.getByLabelText("market status: Open")).toBeTruthy();
  });

  it("uses open dot for regular market", () => {
    render(<MarketStatusWidget status="regular" />);
    expect(screen.getByRole("img", { name: "open" })).toBeTruthy();
  });

  it("uses closed dot for closed market", () => {
    render(<MarketStatusWidget status="closed" />);
    expect(screen.getByRole("img", { name: "closed" })).toBeTruthy();
  });
});
