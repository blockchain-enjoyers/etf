import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs } from "../Tabs";
import { Dialog } from "../Dialog";
import { RadioCards } from "../RadioCards";

const tabItems = [
  { value: "a", label: "Tab A", content: <div>Content A</div> },
  { value: "b", label: "Tab B", content: <div>Content B</div> },
];

describe("Tabs", () => {
  it("renders tab triggers", () => {
    render(<Tabs items={tabItems} />);
    expect(screen.getByRole("tab", { name: "Tab A" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tab B" })).toBeTruthy();
  });

  it("shows first tab content by default", () => {
    render(<Tabs items={tabItems} />);
    expect(screen.getByText("Content A")).toBeTruthy();
  });

  it("switches content on tab click", async () => {
    const user = userEvent.setup();
    render(<Tabs items={tabItems} />);
    await user.click(screen.getByRole("tab", { name: "Tab B" }));
    expect(screen.getByText("Content B")).toBeTruthy();
  });

  it("keyboard: ArrowRight moves focus to next tab", async () => {
    const user = userEvent.setup();
    render(<Tabs items={tabItems} />);
    const tabA = screen.getByRole("tab", { name: "Tab A" });
    tabA.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Tab B" }));
  });
});

describe("Dialog", () => {
  it("renders title when open", () => {
    render(
      <Dialog open title="Confirm Action" onOpenChange={() => {}}>
        <p>Body content</p>
      </Dialog>
    );
    expect(screen.getByText("Confirm Action")).toBeTruthy();
  });

  it("renders children when open", () => {
    render(
      <Dialog open title="Test Dialog" onOpenChange={() => {}}>
        <p>Dialog body</p>
      </Dialog>
    );
    expect(screen.getByText("Dialog body")).toBeTruthy();
  });

  it("renders description when provided", () => {
    render(
      <Dialog open title="Test" description="Some description" onOpenChange={() => {}}>
        <p>x</p>
      </Dialog>
    );
    expect(screen.getByText("Some description")).toBeTruthy();
  });

  it("renders close button", () => {
    render(
      <Dialog open title="Test" onOpenChange={() => {}}>
        <p>x</p>
      </Dialog>
    );
    expect(screen.getByLabelText("close dialog")).toBeTruthy();
  });
});

describe("RadioCards", () => {
  const options = [
    { value: "market", label: "Market ETF", description: "Broad exposure" },
    { value: "sector", label: "Sector ETF", description: "Focused" },
  ];

  it("renders all options", () => {
    render(<RadioCards options={options} />);
    expect(screen.getByText("Market ETF")).toBeTruthy();
    expect(screen.getByText("Sector ETF")).toBeTruthy();
  });

  it("renders descriptions", () => {
    render(<RadioCards options={options} />);
    expect(screen.getByText("Broad exposure")).toBeTruthy();
  });

  it("renders radio inputs", () => {
    render(<RadioCards options={options} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("calls onValueChange when option is clicked", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<RadioCards options={options} onValueChange={onValueChange} />);
    await user.click(screen.getByText("Sector ETF"));
    expect(onValueChange).toHaveBeenCalledWith("sector");
  });
});
