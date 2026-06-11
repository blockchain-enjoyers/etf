import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IronRuleCallout } from "../IronRuleCallout";
import { Guard } from "../Guard";

describe("IronRuleCallout", () => {
  it("explains estimate-vs-settlement when closed", () => {
    render(<IronRuleCallout marketStatus="closed" />);
    expect(screen.getByText(/never a settlement price/i)).toBeInTheDocument();
    expect(screen.getByText(/in-kind redeem/i)).toBeInTheDocument();
  });
  it("renders nothing when market is regular", () => {
    const { container } = render(<IronRuleCallout marketStatus="regular" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Guard", () => {
  it("shows title, detail and a PASS chip", () => {
    render(<Guard status="pass" title="Market open" detail="Regular session." code="g2" />);
    expect(screen.getByText("Market open")).toBeInTheDocument();
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
  });
});
