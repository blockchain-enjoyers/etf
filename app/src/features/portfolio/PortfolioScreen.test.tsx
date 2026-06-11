import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccountHolding, ForwardTicket } from "@meridian/sdk";
import { PortfolioScreen } from "./PortfolioScreen";

const holdingsOpen: AccountHolding[] = [
  {
    vaultAddress: "0xaaaa000000000000000000000000000000000001",
    symbol: "RH5",
    balance: "3000000000000000000",
    valueUsd: "3613500000000000000000",
    estimated: false,
  },
  {
    vaultAddress: "0xaaaa000000000000000000000000000000000002",
    symbol: "AI3",
    balance: "2000000000000000000",
    valueUsd: "1760400000000000000000",
    estimated: false,
  },
];

const holdingsClosed: AccountHolding[] = holdingsOpen.map((h) => ({ ...h, estimated: true }));

const tickets: ForwardTicket[] = [
  {
    id: 42,
    vaultAddress: "0xaaaa000000000000000000000000000000000001",
    owner: "0xabc",
    kind: "redeem",
    amountRaw: "2000000000000000000",
    remainingRaw: "2000000000000000000",
    status: "pending",
    cutoffMs: 1_999_999_999_999,
    createdAtMs: 1_700_000_000_000,
  },
];

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPortfolio(holdings = holdingsOpen, queueTickets = tickets) {
  const qc = makeQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <PortfolioScreen holdings={holdings} queueTickets={queueTickets} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("PortfolioScreen", () => {
  it("renders a holdings row per position with formatted units", () => {
    renderPortfolio();
    expect(screen.getByText("RH5")).toBeInTheDocument();
    expect(screen.getByText("3.0000")).toBeInTheDocument();
  });

  it("renders every returned holding as a position", () => {
    renderPortfolio();
    expect(screen.getByText("RH5")).toBeInTheDocument();
    expect(screen.getByText("AI3")).toBeInTheDocument();
  });

  it("renders the forward-queue ticket row from real ticket fields", () => {
    renderPortfolio();
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("Cash redeem")).toBeInTheDocument();
    expect(screen.getByText("open (authoritative)")).toBeInTheDocument();
  });

  it("renders stat cards: Positions count and Pending count", () => {
    renderPortfolio();
    expect(screen.getByTestId("stat-positions")).toHaveTextContent("2");
    expect(screen.getByTestId("stat-pending")).toHaveTextContent("1");
  });

  it("total value stat does NOT show ~est when no holding is estimated", () => {
    renderPortfolio(holdingsOpen);
    const totalStat = screen.getByTestId("stat-total");
    expect(within(totalStat).queryByText(/~est/i)).not.toBeInTheDocument();
  });

  it("total value stat shows ~est badge when any holding is estimated (market closed)", () => {
    renderPortfolio(holdingsClosed);
    const totalStat = screen.getByTestId("stat-total");
    expect(within(totalStat).getByText(/~est/i)).toBeInTheDocument();
  });

  it("shows EmptyState when there are no holdings and no tickets", () => {
    renderPortfolio([], []);
    expect(screen.getByText(/no positions yet/i)).toBeInTheDocument();
  });

  it("does not show EmptyState when holdings exist", () => {
    renderPortfolio(holdingsOpen, []);
    expect(screen.queryByText(/no positions yet/i)).not.toBeInTheDocument();
  });

  it("queue table is not rendered when there are no pending tickets", () => {
    renderPortfolio(holdingsOpen, []);
    expect(screen.queryByText(/pending/i)).not.toBeInTheDocument();
  });

  it("renders holdings section heading", () => {
    renderPortfolio();
    expect(screen.getByText(/holdings/i)).toBeInTheDocument();
  });

  it("renders pending section heading when tickets exist", () => {
    renderPortfolio();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });
});
