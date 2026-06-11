import { render, screen, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import { makeQueryClient } from "../../lib/query";
import { ApiProvider } from "../../lib/api";
import { FixtureApi } from "../../fixtures/fixture-api";
import { TerminalHeader } from "../../routes/TerminalHeader";
import { StatusBar } from "../StatusBar";

vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}));

// Both global chrome surfaces share one label map (FIX-5): regular → "Open" everywhere,
// so the header and the status bar can never contradict each other.
describe("shared market-status label", () => {
  it("renders Open in both the header and the status bar for regular market", async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <ApiProvider value={new FixtureApi()}>
          <MemoryRouter>
            <header data-testid="hdr">
              <TerminalHeader />
            </header>
            <footer data-testid="sb">
              <StatusBar marketStatus="regular" />
            </footer>
          </MemoryRouter>
        </ApiProvider>
      </QueryClientProvider>,
    );

    // Header status resolves once the feed query loads (regular → "Open").
    const header = screen.getByTestId("hdr");
    await waitFor(() => expect(within(header).getByText("Open")).toBeInTheDocument());

    const statusBar = screen.getByTestId("sb");
    expect(within(statusBar).getByText("Open")).toBeInTheDocument();
  });
});
