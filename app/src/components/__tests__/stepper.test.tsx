import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "../Stepper";
import { StepChips } from "../StepChips";

describe("Stepper", () => {
  const steps = [
    { label: "Define", status: "complete" as const },
    { label: "Weights", status: "active" as const },
    { label: "Review", status: "upcoming" as const },
  ];

  it("renders navigation landmark", () => {
    render(<Stepper steps={steps} />);
    expect(screen.getByRole("navigation", { name: "progress" })).toBeTruthy();
  });

  it("renders all step labels", () => {
    render(<Stepper steps={steps} />);
    expect(screen.getByText("Define")).toBeTruthy();
    expect(screen.getByText("Weights")).toBeTruthy();
    expect(screen.getByText("Review")).toBeTruthy();
  });

  it("marks active step with aria-current=step", () => {
    render(<Stepper steps={steps} />);
    const active = screen.getByText("2");
    expect(active.getAttribute("aria-current")).toBe("step");
  });

  it("renders checkmark for complete step", () => {
    render(<Stepper steps={steps} />);
    expect(screen.getByText("✓")).toBeTruthy();
  });
});

describe("StepChips", () => {
  const chips = [
    { label: "Step 1", active: true },
    { label: "Step 2", active: false },
  ];

  it("renders a list", () => {
    render(<StepChips chips={chips} />);
    expect(screen.getByRole("list")).toBeTruthy();
  });

  it("renders all chips as listitems", () => {
    render(<StepChips chips={chips} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("sets aria-selected true for active chip", () => {
    render(<StepChips chips={chips} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("sets aria-selected false for inactive chip", () => {
    render(<StepChips chips={chips} />);
    const items = screen.getAllByRole("listitem");
    expect(items[1]!.getAttribute("aria-selected")).toBe("false");
  });
});
