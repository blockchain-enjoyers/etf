import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GateBanner } from "../GateBanner";

describe("GateBanner", () => {
  it("renders nothing when the gate is enabled", () => {
    const { container } = render(<GateBanner gate={{ enabled: true, reason: "ok" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("decodes manager-mismatch to plain meaning + fix", () => {
    render(<GateBanner gate={{ enabled: false, reason: "manager-mismatch" }} />);
    expect(screen.getByText(/manager-only tool/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in as the index manager/i)).toBeInTheDocument();
  });

  it("treats market-closed as informational (reassures in-kind still works)", () => {
    render(<GateBanner gate={{ enabled: false, reason: "market-closed" }} />);
    expect(screen.getByText(/in-kind still works/i)).toBeInTheDocument();
  });
});
