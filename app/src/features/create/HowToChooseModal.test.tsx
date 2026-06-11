import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HowToChooseModal } from "./HowToChooseModal";

describe("HowToChooseModal", () => {
  it("renders questions and the comparison table when open", () => {
    render(<HowToChooseModal open onClose={vi.fn()} onPick={vi.fn()} />);
    expect(screen.getByText(/constant proportions/i)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
  it("picks a kind and closes when an answer is chosen", async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<HowToChooseModal open onClose={onClose} onPick={onPick} />);
    await user.click(screen.getByRole("button", { name: /hold target weights/i }));
    expect(onPick).toHaveBeenCalledWith("rebalance");
    expect(onClose).toHaveBeenCalled();
  });
  it("renders nothing when closed", () => {
    render(<HowToChooseModal open={false} onClose={vi.fn()} onPick={vi.fn()} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
