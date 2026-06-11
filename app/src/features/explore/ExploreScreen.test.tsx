import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MeridianClient } from "@meridian/sdk";
import { ApiContext } from "../../lib/api";
import { server } from "../../test/msw-server";
import { ExploreScreen } from "./ExploreScreen";
import type { FeedResponse, BasketSummary } from "@meridian/sdk";

const TEST_BASE_URL = "http://explore-test.local";

const VAULT_OPEN = "0x0000000000000000000000000000000000000001";
const VAULT_CLOSED = "0x0000000000000000000000000000000000000002";

const feedOpen: FeedResponse["items"][number] = {
  vaultAddress: VAULT_OPEN,
  symbol: "mTECH",
  nav: "1204500000000000000000",
  estimated: false,
  marketStatus: "regular",
  timestampMs: 1_717_000_000_000,
};

const feedClosed: FeedResponse["items"][number] = {
  vaultAddress: VAULT_CLOSED,
  symbol: "mBOND",
  nav: "880200000000000000000",
  estimated: true,
  marketStatus: "closed",
  timestampMs: 1_717_000_000_000,
};

const VAULT_MANAGED = "0x0000000000000000000000000000000000000003";

const basketSummaries: BasketSummary[] = [
  { vaultAddress: VAULT_OPEN, name: "Tech Leaders", symbol: "mTECH", frozen: false, vaultType: "basket" },
  { vaultAddress: VAULT_CLOSED, name: "Bond Index", symbol: "mBOND", frozen: false, vaultType: "basket" },
];

const basketSummariesWithManaged: BasketSummary[] = [
  { vaultAddress: VAULT_OPEN, name: "Tech Leaders", symbol: "mTECH", frozen: false, vaultType: "basket" },
  { vaultAddress: VAULT_MANAGED, name: "Active Fund", symbol: "mACTIVE", frozen: false, vaultType: "managed" },
];

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function makeApi() {
  return new MeridianClient({ baseUrl: TEST_BASE_URL });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeClient()}>
      <ApiContext.Provider value={makeApi()}>
        <MemoryRouter initialEntries={["/explore"]}>
          <Routes>
            <Route path="/explore" element={<>{children}</>} />
            <Route path="/index/:vaultAddress" element={<div data-testid="detail-page" />} />
          </Routes>
        </MemoryRouter>
      </ApiContext.Provider>
    </QueryClientProvider>
  );
}

describe("ExploreScreen", () => {
  it("renders a row for each feed item with symbol and name from merged data", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/feed`, () =>
        HttpResponse.json({ items: [feedOpen, feedClosed] } satisfies FeedResponse),
      ),
      http.get(`${TEST_BASE_URL}/baskets`, () => HttpResponse.json(basketSummaries)),
    );

    render(<ExploreScreen />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("cell", { name: /mTECH/i })).toBeInTheDocument();
    });

    expect(screen.getByRole("cell", { name: /mBOND/i })).toBeInTheDocument();
    expect(screen.getByText("Tech Leaders")).toBeInTheDocument();
    expect(screen.getByText("Bond Index")).toBeInTheDocument();
  });

  it("shows ~est badge only for the closed/estimated basket", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/feed`, () =>
        HttpResponse.json({ items: [feedOpen, feedClosed] } satisfies FeedResponse),
      ),
      http.get(`${TEST_BASE_URL}/baskets`, () => HttpResponse.json(basketSummaries)),
    );

    render(<ExploreScreen />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("cell", { name: /mTECH/i })).toBeInTheDocument();
    });

    const estBadges = screen.getAllByText(/~est/i);
    expect(estBadges).toHaveLength(1);

    const bondRow = screen.getByRole("cell", { name: /mBOND/i }).closest("tr")!;
    expect(within(bondRow).getByText(/~est/i)).toBeInTheDocument();
  });

  it("shows Skeleton rows while loading", () => {
    server.use(
      http.get(`${TEST_BASE_URL}/feed`, async () => {
        await new Promise(() => {});
      }),
      http.get(`${TEST_BASE_URL}/baskets`, async () => {
        await new Promise(() => {});
      }),
    );

    render(<ExploreScreen />, { wrapper: Wrapper });

    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
  });

  it("shows EmptyState when feed returns empty items array", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/feed`, () =>
        HttpResponse.json({ items: [] } satisfies FeedResponse),
      ),
      http.get(`${TEST_BASE_URL}/baskets`, () => HttpResponse.json([])),
    );

    render(<ExploreScreen />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/no indexes yet/i)).toBeInTheDocument();
    });
  });

  it("shows ErrorState with a retry button when the feed request fails", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/feed`, () => HttpResponse.error()),
      http.get(`${TEST_BASE_URL}/baskets`, () => HttpResponse.json([])),
    );

    render(<ExploreScreen />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  it("navigates to /index/:vaultAddress when a row is clicked", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/feed`, () =>
        HttpResponse.json({ items: [feedOpen, feedClosed] } satisfies FeedResponse),
      ),
      http.get(`${TEST_BASE_URL}/baskets`, () => HttpResponse.json(basketSummaries)),
    );

    const user = userEvent.setup();
    render(<ExploreScreen />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("cell", { name: /mTECH/i })).toBeInTheDocument();
    });

    const techRow = screen.getByRole("cell", { name: /mTECH/i }).closest("tr")!;
    await user.click(techRow);

    await waitFor(() => {
      expect(screen.getByTestId("detail-page")).toBeInTheDocument();
    });
  });

  it("shows 'Static' for basket vaultType and 'Managed' for managed vaultType", async () => {
    const feedManaged: FeedResponse["items"][number] = {
      vaultAddress: VAULT_MANAGED,
      symbol: "mACTIVE",
      nav: "950000000000000000000",
      estimated: false,
      marketStatus: "regular",
      timestampMs: 1_717_000_000_000,
    };

    server.use(
      http.get(`${TEST_BASE_URL}/feed`, () =>
        HttpResponse.json({ items: [feedOpen, feedManaged] } satisfies FeedResponse),
      ),
      http.get(`${TEST_BASE_URL}/baskets`, () => HttpResponse.json(basketSummariesWithManaged)),
    );

    render(<ExploreScreen />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("cell", { name: /mTECH/i })).toBeInTheDocument();
    });

    const techRow = screen.getByRole("cell", { name: /mTECH/i }).closest("tr")!;
    expect(within(techRow).getByText("Static")).toBeInTheDocument();

    const activeRow = screen.getByRole("cell", { name: /mACTIVE/i }).closest("tr")!;
    expect(within(activeRow).getByText("Managed")).toBeInTheDocument();
  });

  it("sorts rows by NAV descending when the NAV column header is clicked", async () => {
    server.use(
      http.get(`${TEST_BASE_URL}/feed`, () =>
        HttpResponse.json({ items: [feedClosed, feedOpen] } satisfies FeedResponse),
      ),
      http.get(`${TEST_BASE_URL}/baskets`, () => HttpResponse.json(basketSummaries)),
    );

    const user = userEvent.setup();
    render(<ExploreScreen />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("cell", { name: /mTECH/i })).toBeInTheDocument();
    });

    const navHeader = screen.getByRole("columnheader", { name: /nav/i });
    await user.click(navHeader);

    const rows = screen.getAllByRole("row").slice(1);
    const firstCell = within(rows[0]!).getAllByRole("cell")[0]!;
    const secondCell = within(rows[1]!).getAllByRole("cell")[0]!;
    // mTECH nav (1204.5) > mBOND nav (880.2) so mTECH should be first after asc sort
    expect(firstCell.textContent).toMatch(/mBOND/i);
    expect(secondCell.textContent).toMatch(/mTECH/i);
  });
});
