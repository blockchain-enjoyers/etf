import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ActivityScreen } from "./ActivityScreen";

describe("ActivityScreen", () => {
  it("renders the heading", () => {
    render(<ActivityScreen />);
    expect(screen.getByRole("heading", { name: /activity/i })).toBeInTheDocument();
  });

  it("renders the coming-soon empty state", () => {
    render(<ActivityScreen />);
    expect(screen.getByText(/activity feed coming soon/i)).toBeInTheDocument();
  });
});
