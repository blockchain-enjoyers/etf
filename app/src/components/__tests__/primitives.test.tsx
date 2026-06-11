import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Module } from "../Module";
import { Aud } from "../Aud";
import { Chip } from "../Chip";
import { HelpTip } from "../HelpTip";

describe("terminal primitives", () => {
  it("Module renders title and children", () => {
    render(<Module title="Holdings">inside</Module>);
    expect(screen.getByText("Holdings")).toBeInTheDocument();
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("Aud renders the role label", () => {
    render(<Aud role="ap" />);
    expect(screen.getByText(/AP/i)).toBeInTheDocument();
  });

  it("Chip renders variant content", () => {
    render(<Chip variant="ok">PASS</Chip>);
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  it("HelpTip exposes its decoded text", () => {
    render(<HelpTip>NAV is the net asset value.</HelpTip>);
    expect(screen.getByText(/net asset value/i)).toBeInTheDocument();
  });
});
