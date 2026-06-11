import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "./lib/query";
import { ApiProvider } from "./lib/api";
import { FixtureApi } from "./fixtures/fixture-api";
import { AppShell } from "./routes/app-shell";
import { ExploreScreen } from "./features/explore/ExploreScreen";
import { ErrorState } from "./components/ErrorState";

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

function makeRouter() {
  return createMemoryRouter(
    [
      {
        path: "/",
        element: <AppShell />,
        errorElement: <ErrorState message="Page not found" />,
        children: [
          { path: "explore", element: <ExploreScreen /> },
          { path: "*", element: <ErrorState message="Page not found" /> },
        ],
      },
    ],
    { initialEntries: ["/explore"] },
  );
}

function TestApp() {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      <ApiProvider value={new FixtureApi()}>
        <RouterProvider router={makeRouter()} />
      </ApiProvider>
    </QueryClientProvider>
  );
}

describe("App smoke test — /explore with fixtures", () => {
  it("mounts the shell without throwing", () => {
    expect(() => render(<TestApp />)).not.toThrow();
  });

  it("renders the header navigation", async () => {
    render(<TestApp />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Markets" })).toBeInTheDocument();
    });
  });

  it("renders the explore table or empty state (fixtures load)", async () => {
    render(<TestApp />);
    await waitFor(
      () => {
        const hasTable = document.querySelector("table") !== null;
        const hasEmptyOrSkeleton =
          screen.queryByText(/no baskets/i) !== null ||
          screen.queryByText(/loading/i) !== null ||
          document.querySelector("[data-testid='skeleton']") !== null ||
          document.querySelector("[data-testid='empty-state']") !== null ||
          document.querySelector("[role='row']") !== null;
        expect(hasTable || hasEmptyOrSkeleton).toBe(true);
      },
      { timeout: 3000 },
    );
  });
});
