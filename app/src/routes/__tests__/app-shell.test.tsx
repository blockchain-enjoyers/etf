import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import { makeQueryClient } from "../../lib/query";
import { ApiProvider } from "../../lib/api";
import { FixtureApi } from "../../fixtures/fixture-api";
import { AppShell } from "../app-shell";
import { ExploreScreen } from "../../features/explore/ExploreScreen";
import { PortfolioScreen } from "../../features/portfolio/PortfolioScreen";
import { ErrorState } from "../../components/ErrorState";

vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
  RainbowKitProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  getDefaultConfig: vi.fn(() => ({})),
}));

vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    WagmiProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAccount: vi.fn(() => ({ address: undefined, isConnected: false, status: "disconnected" })),
  };
});

function makeRouter(initialPath: string) {
  return createMemoryRouter(
    [
      {
        path: "/",
        element: <AppShell />,
        errorElement: <ErrorState message="Page not found" />,
        children: [
          { path: "explore", element: <ExploreScreen /> },
          { path: "portfolio", element: <PortfolioScreen /> },
          { path: "activity", element: <span data-testid="activity-screen">Activity</span> },
          { path: "create", element: <span data-testid="create-screen">Create</span> },
          { path: "*", element: <ErrorState message="Page not found" /> },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
}

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      <ApiProvider value={new FixtureApi()}>{children}</ApiProvider>
    </QueryClientProvider>
  );
}

function renderAt(path: string) {
  const r = makeRouter(path);
  return render(
    <Providers>
      <RouterProvider router={r} />
    </Providers>,
  );
}

describe("AppShell terminal header", () => {
  it("renders the Meridian brand in the header", async () => {
    renderAt("/explore");
    expect(await screen.findByText(/MERIDIAN/)).toBeInTheDocument();
  });

  it("renders all nav links", async () => {
    renderAt("/explore");
    expect(await screen.findByRole("link", { name: "Markets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Portfolio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create" })).toBeInTheDocument();
  });

  it("marks the Markets link active when on /explore", async () => {
    renderAt("/explore");
    const marketsLink = await screen.findByRole("link", { name: "Markets" });
    expect(marketsLink).toHaveAttribute("aria-current", "page");
  });

  it("marks Portfolio link active when on /portfolio", async () => {
    renderAt("/portfolio");
    const portfolioLink = await screen.findByRole("link", { name: "Portfolio" });
    expect(portfolioLink).toHaveAttribute("aria-current", "page");
    const marketsLink = screen.getByRole("link", { name: "Markets" });
    expect(marketsLink).not.toHaveAttribute("aria-current");
  });

  it("navigating to /portfolio renders the portfolio screen", async () => {
    renderAt("/explore");
    const user = userEvent.setup();
    const portfolioLink = await screen.findByRole("link", { name: "Portfolio" });
    await user.click(portfolioLink);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /portfolio/i })).toBeInTheDocument();
    });
  });
});

describe("Root redirect", () => {
  it("renders AppShell outlet content", async () => {
    const r = createMemoryRouter(
      [
        {
          path: "/",
          element: <AppShell />,
          children: [
            { index: true, element: <span data-testid="index-outlet">index</span> },
            { path: "explore", element: <span data-testid="explore-screen">Explore</span> },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );
    render(
      <Providers>
        <RouterProvider router={r} />
      </Providers>,
    );
    expect(await screen.findByTestId("index-outlet")).toBeInTheDocument();
  });
});
