import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortfolioRoute } from "./PortfolioScreen";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
}));

vi.mock("../../data/useAccountHoldings", () => ({
  useAccountHoldings: () => ({
    data: {
      account: "0xabc",
      holdings: [
        {
          vaultAddress: "0xaaaa000000000000000000000000000000000001",
          symbol: "RH5",
          balance: "3000000000000000000",
          valueUsd: "3613500000000000000000",
          estimated: false,
        },
      ],
    },
  }),
}));

function renderRoute() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/portfolio"]}>
        <Routes>
          <Route path="/portfolio" element={<PortfolioRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PortfolioRoute (connected)", () => {
  it("renders portfolio content from backend account holdings", () => {
    renderRoute();
    expect(screen.getByText("RH5")).toBeInTheDocument();
  });

  it("does not render a forward-queue section (no fixtures; no account-level source yet)", () => {
    renderRoute();
    // The "positions · forward queue" header subtitle is always present; assert the actual
    // pending SECTION (and any fixture ticket) is absent and the in-queue count is zero.
    expect(screen.queryByText(/pending \(forward queue\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText("#42")).not.toBeInTheDocument();
    expect(screen.getByTestId("stat-pending")).toHaveTextContent("0");
  });

  it("shows positions count stat", () => {
    renderRoute();
    expect(screen.getByTestId("stat-positions")).toHaveTextContent("1");
  });

  it("total stat has no ~est badge when holdings are not estimated", () => {
    renderRoute();
    const totalStat = screen.getByTestId("stat-total");
    expect(totalStat).not.toHaveTextContent("~est");
  });
});
