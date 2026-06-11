import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { BasketDetail, KeeperStatus, MeridianApi, RebalanceDetail, SettleGateStatus } from "@meridian/sdk";

const mockUseRebalanceDetail = vi.fn();
const mockUseForwardTickets = vi.fn();
const mockUseSettleGateStatus = vi.fn();
const mockUseKeeperStatus = vi.fn();

vi.mock("../../../data/useRebalanceDetail", () => ({ useRebalanceDetail: () => mockUseRebalanceDetail() }));
vi.mock("../../../data/useForwardTickets", () => ({ useForwardTickets: () => mockUseForwardTickets() }));
vi.mock("../../../data/useSettleGateStatus", () => ({ useSettleGateStatus: () => mockUseSettleGateStatus() }));
vi.mock("../../../data/useKeeperStatus", () => ({ useKeeperStatus: () => mockUseKeeperStatus() }));

const mockCanForwardKeeper = vi.fn();
vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: () => ({
    canForwardKeeper: (...args: unknown[]) => mockCanForwardKeeper(...args),
  }),
}));

vi.mock("../../../wallet/use-tx-plan", () => ({
  useTxPlan: () => ({ run: vi.fn(), status: "idle", currentStep: 0, total: 0, error: null, steps: [] }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xmgr", isConnected: true }),
  useChainId: () => 46630,
}));

import { OperationsWorkspace } from "../workspaces/OperationsWorkspace";

const VAULT = "0xv";

const basket = {
  vaultAddress: VAULT,
  name: "Rebalance Fund",
  symbol: "RBL",
  frozen: false,
  vaultType: "rebalance",
  basketToken: null,
  cashToken: "0xusdc",
  unitSize: "1000000000000000000",
  constituents: [],
  manager: "0xmgr",
} as unknown as BasketDetail;

const rebalance = {
  vaultAddress: VAULT,
  heldTokens: [{ token: "0xt1", balance: "1000000000000000000" }],
  target: [],
  pendingTarget: null,
  lastRebalanceAtMs: null,
  drift: null,
} as unknown as RebalanceDetail;

// One guard pending (g6) → settlement blocked.
const gatePending: SettleGateStatus = {
  open: false,
  navPerShare: "1000000000000000000",
  twap: "1050000000000000000",
  guards: [
    { id: "g0", ok: true, reason: null },
    { id: "g2", ok: true, reason: null },
    { id: "g6", ok: false, reason: "InsufficientPrints" },
    { id: "g8", ok: true, reason: null },
  ],
  estimated: true,
};

const keeper: KeeperStatus = {
  escrow: "2500000000000000000",
  keeperBps: 50,
  payouts: [],
};

const api = {} as unknown as MeridianApi;

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <OperationsWorkspace vaultAddress={VAULT} basket={basket} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUseRebalanceDetail.mockReturnValue({ data: rebalance });
  mockUseForwardTickets.mockReturnValue({ data: [] });
  mockUseSettleGateStatus.mockReturnValue({ data: gatePending });
  mockUseKeeperStatus.mockReturnValue({ data: keeper });
  mockCanForwardKeeper.mockReturnValue({ enabled: true, reason: "ok" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("OperationsWorkspace", () => {
  it("opens with a Keeper / Forward Operator intro", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /Forward Operator/i })).toBeInTheDocument();
    expect(screen.getByText(/keeps cash settlement honest/i)).toBeInTheDocument();
  });

  it("renders the settle-readiness checklist with plain guard rows + PASS/PENDING chips", () => {
    renderWorkspace();
    expect(screen.getByText("Settle-readiness checklist")).toBeInTheDocument();
    expect(screen.getByText(/Vault bootstrapped/i)).toBeInTheDocument();
    expect(screen.getByText(/Enough recent price prints/i)).toBeInTheDocument();
    expect(screen.getAllByText("PASS").length).toBeGreaterThan(0);
    expect(screen.getByText("PENDING")).toBeInTheDocument();
  });

  it("renders record-price and settle controls", () => {
    renderWorkspace();
    expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settle/i })).toBeInTheDocument();
  });

  it("renders keeper escrow and payouts", () => {
    renderWorkspace();
    expect(screen.getByText(/Keeper escrow/i)).toBeInTheDocument();
    expect(screen.getByText(/2\.5000/)).toBeInTheDocument();
    expect(screen.getByText(/no keeper payouts/i)).toBeInTheDocument();
  });

  it("disables settle and shows a note while a guard is pending", () => {
    renderWorkspace();
    expect(screen.getByRole("button", { name: /settle/i })).toBeDisabled();
    expect(screen.getByText(/blocked until every check passes/i)).toBeInTheDocument();
  });

  it("explains via a GateBanner when the wallet is not a keeper", () => {
    mockCanForwardKeeper.mockReturnValue({ enabled: false, reason: "manager-mismatch" });
    renderWorkspace();
    expect(screen.getAllByText(/Manager-only tool/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sign in as the index manager/i).length).toBeGreaterThan(0);
  });
});
