import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpPopover } from "./HelpPopover";

describe("HelpPopover", () => {
  it("always renders the brief", () => {
    render(<HelpPopover brief="short blurb" />);
    expect(screen.getByText("short blurb")).toBeInTheDocument();
  });
  it("reveals the example on click and marks the trigger expanded", async () => {
    const user = userEvent.setup();
    render(<HelpPopover brief="b" extended="long form" example="40% of $1000 = $400" />);
    const trigger = screen.getByRole("button", { name: /help/i });
    expect(screen.queryByText(/40% of \$1000/)).not.toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("long form")).toBeInTheDocument();
    expect(screen.getByText(/40% of \$1000/)).toBeInTheDocument();
  });
  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<HelpPopover brief="b" example="ex" />);
    await user.click(screen.getByRole("button", { name: /help/i }));
    expect(screen.getByText("ex")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("ex")).not.toBeInTheDocument();
  });
  it("does not toggle when there is no extended/example content", async () => {
    const user = userEvent.setup();
    render(<HelpPopover brief="only brief" />);
    await user.click(screen.getByRole("button", { name: /help/i }));
    expect(screen.getByRole("button", { name: /help/i })).toHaveAttribute("aria-expanded", "false");
  });
});
