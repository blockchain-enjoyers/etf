import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import { IndexDetailScreen } from "../IndexDetailScreen";
import type {
  MeridianApi,
  BasketDetail,
  NavResponse,
  HistoryPoint,
  RebalanceDetail,
  KeeperStatus,
  RebalanceHistory,
} from "@meridian/sdk";
import * as useRebalanceDetailMod from "../../../data/useRebalanceDetail";
import * as useKeeperStatusMod from "../../../data/useKeeperStatus";
import * as useRebalanceHistoryMod from "../../../data/useRebalanceHistory";

const VAULT = "0xdeadbeef";

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

const history: HistoryPoint[] = [
  { timestampMs: Date.now() - 3600_000, nav: "99000000000000000000", estimated: false },
  { timestampMs: Date.now(), nav: "100000000000000000000", estimated: false },
];

vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: () => ({
    canMint: (_v: string) => ({ enabled: false, reason: "not-deployed" as const }),
    canRedeemInKind: () => ({ enabled: true, reason: "ok" as const }),
    canRedeemCash: () => ({ enabled: true, reason: "ok" as const }),
    canDeploy: () => ({ enabled: false, reason: "not-deployed" as const }),
    canCurate: () => ({ enabled: false, reason: "not-deployed" as const }),
    canForwardCreate: () => ({ enabled: false, reason: "wallet-disconnected" as const }),
    canForwardRedeem: () => ({ enabled: false, reason: "wallet-disconnected" as const }),
    canForwardCancel: () => ({ enabled: false, reason: "wallet-disconnected" as const }),
    status: () => "absent",
  }),
}));

vi.mock("../../../data/useForwardQueue", () => ({ useForwardQueue: () => ({ data: undefined }) }));
vi.mock("../../../data/useForwardTickets", () => ({ useForwardTickets: () => ({ data: [] }) }));
vi.mock("../../../data/useSettleGateStatus", () => ({ useSettleGateStatus: () => ({ data: undefined }) }));

vi.mock("../../../data/useRebalanceDetail", () => ({
  useRebalanceDetail: vi.fn(() => ({ data: undefined })),
}));

vi.mock("../../../data/useKeeperStatus", () => ({
  useKeeperStatus: vi.fn(() => ({ data: undefined })),
}));

vi.mock("../../../data/useRebalanceHistory", () => ({
  useRebalanceHistory: vi.fn(() => ({ data: undefined })),
}));

vi.mock("../../../wallet/use-tx-plan", () => ({
  useTxPlan: () => ({ run: vi.fn(), status: "idle", currentStep: 0, total: 0, error: null, steps: [] }),
}));

vi.mock("../../../data/useMintQuote", () => ({
  useMintQuote: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
}));

vi.mock("../../../data/useAccountHoldings", () => ({
  useAccountHoldings: () => ({ data: { account: "0x0", holdings: [] } }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useChainId: () => 46630,
}));

function makeApi(nav: NavResponse): MeridianApi {
  return {
    getFeed: vi.fn().mockResolvedValue({ items: [] }),
    listBaskets: vi.fn().mockResolvedValue([]),
    getBasket: vi.fn().mockResolvedValue(basket),
    getNav: vi.fn().mockResolvedValue(nav),
    getMarketPrice: vi.fn().mockResolvedValue({ vaultAddress: VAULT, marketPrice: nav.nav, timestampMs: Date.now() }),
    getPremiumDiscount: vi.fn().mockResolvedValue({ premiumBps: 0, nav: nav.nav, marketPrice: nav.nav }),
    getHistory: vi.fn().mockResolvedValue(history),
    getRedeemQuote: vi.fn().mockResolvedValue({ assets: [], gateState: { gated: false, reason: "none" } }),
  } as unknown as MeridianApi;
}

// A rebalance basket exposes all four workspace tabs; static types expose only Trade.
const rebalanceBasketTop: BasketDetail = {
  ...basket,
  name: "Rebalance Fund",
  symbol: "RBL",
  vaultType: "rebalance",
  constituents: [],
  manager: "0xmanager",
};

const rebalanceDetailTop: RebalanceDetail = {
  vaultAddress: VAULT,
  heldTokens: [],
  target: [],
  pendingTarget: null,
  lastRebalanceAtMs: null,
  drift: null,
};

function renderScreen(api: MeridianApi) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <MemoryRouter initialEntries={[`/index/${VAULT}`]}>
          <Routes>
            <Route path="/index/:vaultAddress" element={<IndexDetailScreen />} />
          </Routes>
        </MemoryRouter>
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

function renderRebalance() {
  const api = { ...makeApi(openNav), getBasket: vi.fn().mockResolvedValue(rebalanceBasketTop) } as unknown as MeridianApi;
  vi.mocked(useRebalanceDetailMod.useRebalanceDetail).mockReturnValue({
    data: rebalanceDetailTop,
  } as ReturnType<typeof useRebalanceDetailMod.useRebalanceDetail>);
  return renderScreen(api);
}

describe("IndexDetailScreen — orchestrator", () => {
  beforeEach(() => {
    vi.mocked(useRebalanceDetailMod.useRebalanceDetail).mockReturnValue({ data: undefined } as ReturnType<typeof useRebalanceDetailMod.useRebalanceDetail>);
    vi.mocked(useKeeperStatusMod.useKeeperStatus).mockReturnValue({ data: undefined } as ReturnType<typeof useKeeperStatusMod.useKeeperStatus>);
    vi.mocked(useRebalanceHistoryMod.useRebalanceHistory).mockReturnValue({ data: undefined } as ReturnType<typeof useRebalanceHistoryMod.useRebalanceHistory>);
  });

  it("shows the instrument bar with the basket symbol", async () => {
    renderScreen(makeApi(openNav));
    // The symbol also appears as a muted label in the Order Rail header, so scope to the
    // instrument bar (the element holding the index name) for an unambiguous assertion.
    await waitFor(() => screen.getByText("Tech Giants"));
    const instrumentBar = screen.getByText("Tech Giants").closest("div.bg-bg2");
    expect(instrumentBar).not.toBeNull();
    expect(within(instrumentBar as HTMLElement).getByText("TECH")).toBeInTheDocument();
  });

  it("renders the four workspace tabs for a rebalance vault", async () => {
    renderRebalance();
    await waitFor(() => expect(screen.getAllByText("RBL").length).toBeGreaterThan(0));
    // Scope to the workspace tablist (the one holding the Trade tab); OrderRail has its own tabs.
    const workspaceTablist = screen.getByRole("tab", { name: /Trade/ }).closest("[role=tablist]");
    expect(workspaceTablist).not.toBeNull();
    const tabs = within(workspaceTablist as HTMLElement).getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    for (const name of [/Trade/, /Liquidity/, /Operations/, /Manage/]) {
      expect(within(workspaceTablist as HTMLElement).getByRole("tab", { name })).toBeInTheDocument();
    }
  });

  it("renders only the Trade tab for a non-rebalance (basket) vault", async () => {
    renderScreen(makeApi(openNav));
    await waitFor(() => expect(screen.getAllByText("TECH").length).toBeGreaterThan(0));
    const workspaceTablist = screen.getByRole("tab", { name: /Trade/ }).closest("[role=tablist]");
    expect(workspaceTablist).not.toBeNull();
    const tabs = within(workspaceTablist as HTMLElement).getAllByRole("tab");
    expect(tabs).toHaveLength(1);
    for (const name of [/Liquidity/, /Operations/, /Manage/]) {
      expect(within(workspaceTablist as HTMLElement).queryByRole("tab", { name })).not.toBeInTheDocument();
    }
  });

  it("defaults to the Trade workspace (holdings module visible)", async () => {
    renderScreen(makeApi(openNav));
    await waitFor(() => expect(screen.getAllByText("TECH").length).toBeGreaterThan(0));
    expect(screen.getByRole("tab", { name: /Trade/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("holdings-table")).toBeInTheDocument();
  });

  it("shows the onboarding hint on the default Trade view of a rebalance vault", async () => {
    renderRebalance();
    await waitFor(() => expect(screen.getAllByText("RBL").length).toBeGreaterThan(0));
    expect(screen.getByText(/New here\? Stay on Trade\./i)).toBeInTheDocument();
    expect(
      screen.getByText(/Only open Liquidity, Operations or Manage if you're an AP, an operator, or the manager\./i),
    ).toBeInTheDocument();
  });

  it("hides the onboarding hint for a non-rebalance (basket) vault", async () => {
    renderScreen(makeApi(openNav));
    await waitFor(() => expect(screen.getAllByText("TECH").length).toBeGreaterThan(0));
    expect(screen.queryByText(/New here\? Stay on Trade\./i)).not.toBeInTheDocument();
  });

  it("switches content when another tab is clicked (rebalance vault)", async () => {
    const user = userEvent.setup();
    renderRebalance();
    await waitFor(() => expect(screen.getAllByText("RBL").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: /Liquidity/ }));
    expect(screen.getByRole("tab", { name: /Liquidity/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("IndexDetailScreen — instrument stat line", () => {
  beforeEach(() => {
    vi.mocked(useRebalanceDetailMod.useRebalanceDetail).mockReturnValue({ data: undefined } as ReturnType<typeof useRebalanceDetailMod.useRebalanceDetail>);
    vi.mocked(useKeeperStatusMod.useKeeperStatus).mockReturnValue({ data: undefined } as ReturnType<typeof useKeeperStatusMod.useKeeperStatus>);
    vi.mocked(useRebalanceHistoryMod.useRebalanceHistory).mockReturnValue({ data: undefined } as ReturnType<typeof useRebalanceHistoryMod.useRebalanceHistory>);
  });
  it("shows the 'Your holding' stat", async () => {
    renderScreen(makeApi(openNav));
    await waitFor(() => expect(screen.getAllByText("TECH").length).toBeGreaterThan(0));
    expect(screen.getByText("Your holding")).toBeInTheDocument();
  });

  it("shows the 'Premium' stat", async () => {
    renderScreen(makeApi(openNav));
    await waitFor(() => expect(screen.getAllByText("TECH").length).toBeGreaterThan(0));
    expect(screen.getByText("Premium")).toBeInTheDocument();
  });
});

describe("IndexDetailScreen — rebalance vault", () => {
  const rebalanceBasket: BasketDetail = {
    vaultAddress: VAULT,
    name: "Rebalance Fund",
    symbol: "RBL",
    frozen: false,
    vaultType: "rebalance",
    basketToken: null,
    cashToken: null,
    unitSize: "1000000000000000000",
    constituents: [],
    manager: "0xmanager",
  };

  const rebalanceDetail: RebalanceDetail = {
    vaultAddress: VAULT,
    heldTokens: [],
    target: [],
    pendingTarget: null,
    lastRebalanceAtMs: null,
    drift: null,
  };

  const keeperStatus: KeeperStatus = { escrow: "0", keeperBps: 0, payouts: [] };
  const rebalanceHistory: RebalanceHistory = { items: [] };

  beforeEach(() => {
    vi.mocked(useRebalanceDetailMod.useRebalanceDetail).mockReturnValue({ data: rebalanceDetail } as ReturnType<typeof useRebalanceDetailMod.useRebalanceDetail>);
    vi.mocked(useKeeperStatusMod.useKeeperStatus).mockReturnValue({ data: keeperStatus } as ReturnType<typeof useKeeperStatusMod.useKeeperStatus>);
    vi.mocked(useRebalanceHistoryMod.useRebalanceHistory).mockReturnValue({ data: rebalanceHistory } as ReturnType<typeof useRebalanceHistoryMod.useRebalanceHistory>);
  });

  function renderRebalanceScreen() {
    const api = {
      ...makeApi(openNav),
      getBasket: vi.fn().mockResolvedValue(rebalanceBasket),
    } as unknown as MeridianApi;
    return renderScreen(api);
  }

  it("enables the non-trade tabs (no 'Not available' message) for a rebalance vault", async () => {
    const user = userEvent.setup();
    renderRebalanceScreen();
    await waitFor(() => expect(screen.getAllByText("RBL").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: /Liquidity/ }));
    expect(screen.queryByText(/Not available for this vault type/i)).not.toBeInTheDocument();
  });
});
