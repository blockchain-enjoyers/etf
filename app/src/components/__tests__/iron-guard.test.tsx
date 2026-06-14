import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Guard } from "../Guard";

describe("Guard", () => {
  it("shows title, detail and a PASS chip", () => {
    render(<Guard status="pass" title="Market open" detail="Regular session." code="g2" />);
    expect(screen.getByText("Market open")).toBeInTheDocument();
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
  });
});
