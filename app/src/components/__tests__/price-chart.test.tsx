import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceChart } from "../PriceChart";
import type { HistoryPoint } from "@meridian/sdk";

const mockData: HistoryPoint[] = [
  { timestampMs: 1700000000000, nav: "1000000000000000000", estimated: false },
  { timestampMs: 1700003600000, nav: "1010000000000000000", estimated: false },
];

describe("PriceChart", () => {
  it("mounts and renders a container", () => {
    render(<PriceChart data={mockData} />);
    expect(screen.getByTestId("price-chart")).toBeTruthy();
  });

  it("has img role", () => {
    render(<PriceChart data={mockData} />);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  it("default aria-label is price chart", () => {
    render(<PriceChart data={mockData} />);
    expect(screen.getByRole("img", { name: "price chart" })).toBeTruthy();
  });

  it("aria-label includes estimated when estimated is true", () => {
    render(<PriceChart data={mockData} estimated />);
    expect(screen.getByRole("img", { name: "price chart (estimated)" })).toBeTruthy();
  });

  it("renders with empty data without throwing", () => {
    expect(() => render(<PriceChart data={[]} />)).not.toThrow();
  });
});
