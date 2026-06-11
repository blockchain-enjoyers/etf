import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeightBar } from "../WeightBar";
import { ConfidenceBand } from "../ConfidenceBand";

describe("WeightBar", () => {
  it("renders with img role", () => {
    render(<WeightBar segments={[{ label: "AAPL", weight: 50 }, { label: "MSFT", weight: 50 }]} />);
    expect(screen.getByRole("img", { name: "weight distribution" })).toBeTruthy();
  });
  it("renders a segment per entry", () => {
    const { container } = render(
      <WeightBar segments={[{ label: "AAPL", weight: 30 }, { label: "MSFT", weight: 70 }]} />
    );
    const segments = container.querySelectorAll("[title]");
    expect(segments).toHaveLength(2);
  });
  it("shows percentage in title", () => {
    const { container } = render(
      <WeightBar segments={[{ label: "AAPL", weight: 100 }]} />
    );
    const seg = container.querySelector("[title]");
    expect(seg?.getAttribute("title")).toContain("100.0%");
  });
});

describe("ConfidenceBand", () => {
  it("renders with img role", () => {
    render(<ConfidenceBand widthPct={40} />);
    expect(screen.getByRole("img", { name: "confidence band" })).toBeTruthy();
  });
  it("accepts custom aria-label", () => {
    render(<ConfidenceBand widthPct={40} aria-label="NAV confidence" />);
    expect(screen.getByRole("img", { name: "NAV confidence" })).toBeTruthy();
  });
  it("clamps negative widthPct to 0", () => {
    const { container } = render(<ConfidenceBand widthPct={-10} />);
    const inner = container.querySelector("[style]");
    expect(inner?.getAttribute("style")).toContain("width: 0%");
  });
  it("clamps widthPct above 100 to 100", () => {
    const { container } = render(<ConfidenceBand widthPct={150} />);
    const inner = container.querySelector("[style]");
    expect(inner?.getAttribute("style")).toContain("width: 100%");
  });
});
