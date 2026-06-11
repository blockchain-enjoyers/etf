import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { BasketDetail, MeridianApi, RebalanceDetail, RebalanceHistory } from "@meridian/sdk";

const mockUseRebalanceHistory = vi.fn();
vi.mock("../../../data/useRebalanceHistory", () => ({
  useRebalanceHistory: () => mockUseRebalanceHistory(),
}));

const mockCanCurate = vi.fn();
vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: () => ({
    canCurate: (...args: unknown[]) => mockCanCurate(...args),
  }),
}));

vi.mock("../../../wallet/use-tx-plan", () => ({
  useTxPlan: () => ({ run: vi.fn(), status: "idle", currentStep: 0, total: 0, error: null, steps: [] }),
}));

let connected = { address: "0xmgr", isConnected: true };
vi.mock("wagmi", () => ({
  useAccount: () => connected,
  useChainId: () => 46630,
  useReadContract: () => ({ data: undefined, isError: false, isLoading: false }),
}));

import { ManageWorkspace } from "../workspaces/ManageWorkspace";

const VAULT = "0xv";
const TOKEN_A = "0x1111111111111111111111111111111111111111";

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

const rebalance: RebalanceDetail = {
  vaultAddress: VAULT,
  heldTokens: [{ token: TOKEN_A, balance: "5000000000000000000" }],
  target: [{ token: TOKEN_A, unitQty: "1000000000000000000" }],
  pendingTarget: null,
  lastRebalanceAtMs: null,
  drift: { isDue: true, triggerBandBps: 250, items: [{ token: TOKEN_A, driftBps: 300 }] },
};

const historyEmpty: RebalanceHistory = { items: [] };

const api = {} as unknown as MeridianApi;

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <ManageWorkspace vaultAddress={VAULT} basket={basket} rebalance={rebalance} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  connected = { address: "0xmgr", isConnected: true };
  mockUseRebalanceHistory.mockReturnValue({ data: historyEmpty });
  mockCanCurate.mockReturnValue({ enabled: true, reason: "ok" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ManageWorkspace", () => {
  it("opens with a Curator / Manager intro", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /Curator/i })).toBeInTheDocument();
    expect(screen.getByText(/schedules target weights/i)).toBeInTheDocument();
  });

  it("renders drift status as a chip (Rebalance due)", () => {
    renderWorkspace();
    expect(screen.getAllByText(/Rebalance due/i).length).toBeGreaterThan(0);
  });

  it("renders holdings vs target", () => {
    renderWorkspace();
    expect(screen.getByText(/Holdings vs Target/i)).toBeInTheDocument();
  });

  it("renders the schedule-target form", () => {
    renderWorkspace();
    expect(screen.getByRole("button", { name: /schedule new target/i })).toBeInTheDocument();
  });

  it("renders the auction section", () => {
    renderWorkspace();
    expect(screen.getAllByText(/Rebalance auction/i).length).toBeGreaterThan(0);
  });

  it("renders rebalance history", () => {
    renderWorkspace();
    expect(screen.getAllByText(/Rebalance history/i).length).toBeGreaterThan(0);
  });

  it("shows a GateBanner and disables curator actions when the wallet is not the manager", () => {
    connected = { address: "0xnotmgr", isConnected: true };
    mockCanCurate.mockReturnValue({ enabled: false, reason: "manager-mismatch" });
    renderWorkspace();
    expect(screen.getAllByText(/Manager-only tool/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sign in as the index manager/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /schedule new target/i })).toBeDisabled();
    // read-only data still renders
    expect(screen.getByText(/Holdings vs Target/i)).toBeInTheDocument();
  });
});
