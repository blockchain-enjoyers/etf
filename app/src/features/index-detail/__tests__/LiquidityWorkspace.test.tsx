import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { BasketDetail, ForwardQueue, MeridianApi, SettleGateStatus } from "@meridian/sdk";

const mockUseForwardQueue = vi.fn();
const mockUseForwardTickets = vi.fn();
const mockUseSettleGateStatus = vi.fn();

vi.mock("../../../data/useForwardQueue", () => ({ useForwardQueue: () => mockUseForwardQueue() }));
vi.mock("../../../data/useForwardTickets", () => ({ useForwardTickets: () => mockUseForwardTickets() }));
vi.mock("../../../data/useSettleGateStatus", () => ({ useSettleGateStatus: () => mockUseSettleGateStatus() }));

const mockCanForwardCreate = vi.fn();
vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: () => ({
    canForwardCreate: (...args: unknown[]) => mockCanForwardCreate(...args),
    canForwardRedeem: () => ({ enabled: true, reason: "ok" as const }),
    canForwardCancel: () => ({ enabled: true, reason: "ok" as const }),
  }),
}));

vi.mock("../../../wallet/use-tx-plan", () => ({
  useTxPlan: () => ({ run: vi.fn(), status: "idle", currentStep: 0, total: 0, error: null, steps: [] }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xme", isConnected: true }),
  useChainId: () => 46630,
}));

import { LiquidityWorkspace } from "../workspaces/LiquidityWorkspace";

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

const queue: ForwardQueue = {
  queueAddress: "0xq",
  tickets: [],
  capacity: { maxCreateFlowBps: 250, windowCapShares: "5000000000000000000", pendingCreateCash: "1200000000", pendingRedeemShares: "0" },
};

const gate: SettleGateStatus = { open: true, navPerShare: "1000000000000000000", twap: null, guards: [], estimated: true };

const api = {} as unknown as MeridianApi;

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <LiquidityWorkspace vaultAddress={VAULT} basket={basket} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUseForwardQueue.mockReturnValue({ data: queue });
  mockUseForwardTickets.mockReturnValue({ data: [] });
  mockUseSettleGateStatus.mockReturnValue({ data: gate });
  mockCanForwardCreate.mockReturnValue({ enabled: true, reason: "ok" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LiquidityWorkspace", () => {
  it("opens with an Authorized Participant intro", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /Authorized Participant/i })).toBeInTheDocument();
    expect(screen.getByText(/for liquidity providers/i)).toBeInTheDocument();
  });

  it("renders forward-create, forward-redeem, capacity and my-tickets regions", () => {
    renderWorkspace();
    expect(screen.getByText("Forward create")).toBeInTheDocument();
    expect(screen.getByText("Forward redeem (cash)")).toBeInTheDocument();
    expect(screen.getByText("Create capacity")).toBeInTheDocument();
    expect(screen.getByText("Open tickets")).toBeInTheDocument();
  });

  it("explains why forward create is blocked with a GateBanner", () => {
    mockCanForwardCreate.mockReturnValue({ enabled: false, reason: "wallet-disconnected" });
    renderWorkspace();
    expect(screen.getByText(/No wallet attached/i)).toBeInTheDocument();
  });

  it("shows raw capacity math", () => {
    renderWorkspace();
    expect(screen.getByText(/bps of supply/i)).toBeInTheDocument();
  });
});
