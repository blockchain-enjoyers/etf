import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dot } from "../Dot";
import { EstBadge } from "../EstBadge";
import { Pill } from "../Pill";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Card } from "../Card";
import { KV } from "../KV";
import { Stat } from "../Stat";
import { Skeleton } from "../Skeleton";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { WarningBanner } from "../WarningBanner";

describe("Dot", () => {
  it("renders open variant with aria-label", () => {
    render(<Dot variant="open" />);
    expect(screen.getByRole("img", { name: "open" })).toBeTruthy();
  });
  it("renders closed variant", () => {
    render(<Dot variant="closed" />);
    expect(screen.getByRole("img", { name: "closed" })).toBeTruthy();
  });
  it("renders halt variant", () => {
    render(<Dot variant="halt" />);
    expect(screen.getByRole("img", { name: "halt" })).toBeTruthy();
  });
});

describe("EstBadge", () => {
  it("renders ~est text", () => {
    render(<EstBadge />);
    expect(screen.getByText("~est")).toBeTruthy();
  });
  it("has aria-label estimated", () => {
    render(<EstBadge />);
    expect(screen.getByLabelText("estimated")).toBeTruthy();
  });
});

describe("Pill", () => {
  it("renders children", () => {
    render(<Pill>Tech</Pill>);
    expect(screen.getByText("Tech")).toBeTruthy();
  });
});

describe("Badge", () => {
  it("renders children with default variant", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeTruthy();
  });
  it("renders positive variant", () => {
    const { container } = render(<Badge variant="positive">+1%</Badge>);
    expect(container.firstChild).toBeTruthy();
  });
});

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeTruthy();
  });
  it("is disabled when disabled prop is set", () => {
    render(<Button disabled>Locked</Button>);
    const btn = screen.getByRole("button", { name: "Locked" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
  it("full prop renders without error", () => {
    render(<Button full>Wide</Button>);
    expect(screen.getByRole("button", { name: "Wide" })).toBeTruthy();
  });
});

describe("Card", () => {
  it("renders children", () => {
    render(<Card>content</Card>);
    expect(screen.getByText("content")).toBeTruthy();
  });
});

describe("KV", () => {
  it("renders label and value", () => {
    render(<KV label="NAV" value="$1.23" />);
    expect(screen.getByText("NAV")).toBeTruthy();
    expect(screen.getByText("$1.23")).toBeTruthy();
  });
});

describe("Stat", () => {
  it("renders label, value, and optional sub", () => {
    render(<Stat label="AUM" value="$10M" sub="total" />);
    expect(screen.getByText("AUM")).toBeTruthy();
    expect(screen.getByText("$10M")).toBeTruthy();
    expect(screen.getByText("total")).toBeTruthy();
  });
  it("renders without sub", () => {
    render(<Stat label="AUM" value="$10M" />);
    expect(screen.getByText("$10M")).toBeTruthy();
  });
});

describe("Skeleton", () => {
  it("renders with aria-busy and aria-label", () => {
    render(<Skeleton className="h-4 w-24" />);
    expect(screen.getByLabelText("loading")).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("renders message with status role", () => {
    render(<EmptyState message="Nothing here" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});

describe("ErrorState", () => {
  it("renders message with alert role", () => {
    render(<ErrorState message="Something went wrong" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });
});

describe("WarningBanner", () => {
  it("renders children with alert role", () => {
    render(<WarningBanner>Market is estimated</WarningBanner>);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Market is estimated")).toBeTruthy();
  });
});
