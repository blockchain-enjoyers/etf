import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TxStatus } from "../TxStatus";

const HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

describe("TxStatus", () => {
  it("renders nothing when fully idle", () => {
    const { container } = render(
      <TxStatus isPending={false} isConfirming={false} isSuccess={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Submitting… when pending", () => {
    render(<TxStatus isPending isConfirming={false} isSuccess={false} />);
    expect(screen.getByText(/submitting/i)).toBeInTheDocument();
  });

  it("shows Confirming… when confirming", () => {
    render(<TxStatus isPending={false} isConfirming isSuccess={false} />);
    expect(screen.getByText(/confirming/i)).toBeInTheDocument();
  });

  it("shows Confirmed ✓ on success", () => {
    render(<TxStatus isPending={false} isConfirming={false} isSuccess />);
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
  });

  it("prioritizes error over other states", () => {
    render(
      <TxStatus
        isPending
        isConfirming
        isSuccess
        error={new Error("user rejected the request")}
      />,
    );
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByText(/user rejected the request/i)).toBeInTheDocument();
    expect(screen.queryByText(/confirmed/i)).not.toBeInTheDocument();
  });

  it("truncates long error messages to first line and ~120 chars", () => {
    const long = "x".repeat(300) + "\nsecond line should not appear";
    render(
      <TxStatus
        isPending={false}
        isConfirming={false}
        isSuccess={false}
        error={new Error(long)}
      />,
    );
    expect(screen.queryByText(/second line should not appear/i)).not.toBeInTheDocument();
    const node = screen.getByText(/failed/i);
    expect(node.textContent!.length).toBeLessThan(140);
  });

  it("renders an explorer link when hash is present", () => {
    render(
      <TxStatus hash={HASH} isPending={false} isConfirming={false} isSuccess />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining(HASH));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("does not render a link when hash is absent", () => {
    render(<TxStatus isPending isConfirming={false} isSuccess={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
