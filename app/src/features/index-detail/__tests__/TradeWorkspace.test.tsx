import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import { TradeWorkspace } from "../workspaces/TradeWorkspace";
import type { BasketDetail, HoldingRow, MeridianApi, NavResponse } from "@meridian/sdk";

const VAULT = "0xabc";

const basket: BasketDetail = {
  vaultAddress: VAULT,
  name: "Tech Giants",
  symbol: "TECH",
  frozen: false,
  vaultType: "basket",
  basketToken: null,
  cashToken: null,
  unitSize: "1000000000000000000",
  constituents: [
    { token: "0x1111111111111111111111111111111111111111", unitQty: "500000000000000000" },
    { token: "0x2222222222222222222222222222222222222222", unitQty: "250000000000000000" },
  ],
};

const openNav: NavResponse = {
  vaultAddress: VAULT,
  nav: "100000000000000000000",
  confidenceLower: "99000000000000000000",
  confidenceUpper: "101000000000000000000",
  marketStatus: "regular",
  estimated: false,
  source: "chainlink",
  timestampMs: Date.now(),
};

const holdingRow: HoldingRow = {
  token: "0x1111111111111111111111111111111111111111",
  symbol: "AAPL",
  name: "Apple Inc.",
  decimals: 18,
  qtyPerUnit: "500000000000000000",
  priceUsd: "180000000000000000000",
  valuePerUnitUsd: "90000000000000000000",
  currentWeightBps: 5000,
  targetWeightBps: 5000,
  driftBps: 0,
  estimated: false,
};

vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: () => ({
    canMint: () => ({ enabled: true, reason: "ok" as const }),
    canRedeemInKind: () => ({ enabled: true, reason: "ok" as const }),
    canRedeemCash: () => ({ enabled: true, reason: "ok" as const }),
    canForwardRedeem: () => ({ enabled: true, reason: "ok" as const }),
    status: () => "live" as const,
  }),
}));

vi.mock("../../../data/useHoldings", () => ({
  useHoldings: () => ({
    data: {
      vaultAddress: VAULT,
      navPerUnit: "100000000000000000000",
      estimated: false,
      timestampMs: Date.now(),
      holdings: [holdingRow],
    },
  }),
}));

vi.mock("../../../data/useAccountHoldings", () => ({
  useAccountHoldings: () => ({
    data: {
      account: "0xme",
      holdings: [
        {
          vaultAddress: VAULT,
          symbol: "TECH",
          balance: "3000000000000000000",
          valueUsd: "300000000000000000000",
          estimated: false,
        },
      ],
    },
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xme", isConnected: true }),
  useReadContract: () => ({ data: undefined, isError: false, isLoading: false }),
  useReadContracts: () => ({ data: undefined }),
}));

const api = {
  getHistory: vi.fn().mockResolvedValue([]),
} as unknown as MeridianApi;

function renderWorkspace(basketOverride: BasketDetail = basket) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <TradeWorkspace vaultAddress={VAULT} basket={basketOverride} nav={openNav} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

describe("TradeWorkspace", () => {
  it("renders the holdings module with constituent symbols", () => {
    renderWorkspace();
    expect(screen.getAllByText(/Holdings/i).length).toBeGreaterThan(0);
    const holdingsTable = screen.getByTestId("holdings-table");
    expect(holdingsTable).toBeInTheDocument();
  });

  it("renders a holding row from the backend holdings data", () => {
    renderWorkspace();
    const holdingsTable = screen.getByTestId("holdings-table");
    expect(holdingsTable.textContent).toContain("AAPL");
  });

  it("offers an in-kind redeem action", () => {
    renderWorkspace();
    expect(screen.getAllByText(/Redeem in-kind/i).length).toBeGreaterThan(0);
  });

  it("hides the cash redeem card for a static (basket) vault", () => {
    renderWorkspace();
    expect(screen.queryByText(/Redeem to cash \(USDC\)/i)).not.toBeInTheDocument();
  });

  it("shows the cash redeem card for a rebalance vault", () => {
    renderWorkspace({ ...basket, vaultType: "rebalance" });
    expect(screen.getByText(/Redeem to cash \(USDC\)/i)).toBeInTheDocument();
  });

  it("always shows the price chart at the top", () => {
    renderWorkspace();
    expect(screen.getByTestId("price-chart")).toBeInTheDocument();
  });

  it("shows the connected holder's position: units and USD value", () => {
    renderWorkspace();
    expect(screen.getByText(/Your position/i)).toBeInTheDocument();
    // 3 units of the vault token (formatQty → 3.0000).
    expect(screen.getByText(/3\.0000 TECH/)).toBeInTheDocument();
    // $300.00 from account holdings valueUsd.
    expect(screen.getByText(/\$300\.00/)).toBeInTheDocument();
  });
});
