import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { BasketDetail, MeridianApi, SettleGateStatus } from "@meridian/sdk";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0xme", isConnected: true }) }));
vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: () => ({ canForwardRedeem: () => ({ enabled: true, reason: "ok" as const }) }),
}));

const mockRun = vi.fn();
const txDefaults = () => ({
  run: mockRun,
  status: "idle" as const,
  currentStep: 0,
  total: 0,
  error: null as string | null,
  steps: [] as { label: string }[],
});
const mockUseTxPlan = vi.fn((_seed?: string[]) => txDefaults());
vi.mock("../../../wallet/use-tx-plan", () => ({
  useTxPlan: (seed?: string[]) => mockUseTxPlan(seed),
}));

// Queue lookup for the allowlist seed (undefined → seed is just the vault clone).
vi.mock("../../../data/useForwardQueue", () => ({
  useForwardQueue: () => ({ data: undefined }),
}));

import { queryKeys } from "../../../lib/query";
import { ForwardRedeemPanel } from "../ForwardRedeemPanel";

const basket = {
  vaultAddress: "0xv", name: "R", symbol: "R", frozen: false, vaultType: "rebalance",
  basketToken: null, cashToken: "0xusdc", unitSize: "1000000000000000000", constituents: [],
} as unknown as BasketDetail;

const gate: SettleGateStatus = {
  open: true, navPerShare: "1000000000000000000", twap: null, guards: [], estimated: true,
};

const api = { buildForwardRedeemTx: vi.fn() } as unknown as MeridianApi;
const mockInvalidate = vi.fn();

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.invalidateQueries = mockInvalidate as never;
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue(undefined);
  mockUseTxPlan.mockReset();
  mockUseTxPlan.mockImplementation(() => txDefaults());
  mockInvalidate.mockReset();
  (api.buildForwardRedeemTx as ReturnType<typeof vi.fn>).mockReset();
});

describe("ForwardRedeemPanel", () => {
  it("shows an estimated cash-out label", () => {
    render(<ForwardRedeemPanel vaultAddress="0xv" basket={basket} gate={gate} />, { wrapper: makeWrapper() });
    expect(screen.getByLabelText(/estimated/i)).toBeInTheDocument();
  });

  it("seeds useTxPlan with the vault clone as the allowlist (queue pulls the share token)", () => {
    render(<ForwardRedeemPanel vaultAddress="0xv" basket={basket} gate={gate} />, { wrapper: makeWrapper() });
    expect(mockUseTxPlan).toHaveBeenCalledWith(["0xv"]);
  });

  it("queue redeem runs a buildForwardRedeemTx fetcher with 18-dec shares", async () => {
    const user = userEvent.setup();
    render(<ForwardRedeemPanel vaultAddress="0xv" basket={basket} gate={gate} />, { wrapper: makeWrapper() });
    await user.clear(screen.getByLabelText(/shares amount/i));
    await user.type(screen.getByLabelText(/shares amount/i), "2");
    await user.click(screen.getByRole("button", { name: /queue redeem/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildForwardRedeemTx).toHaveBeenCalledWith("0xv", {
      shares: "2000000000000000000",
      account: "0xme",
    });
  });

  it("invalidates the forward queries after the redeem resolves", async () => {
    const user = userEvent.setup();
    render(<ForwardRedeemPanel vaultAddress="0xv" basket={basket} gate={gate} />, { wrapper: makeWrapper() });
    await user.type(screen.getByLabelText(/shares amount/i), "2");
    await user.click(screen.getByRole("button", { name: /queue redeem/i }));
    await waitFor(() =>
      expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: queryKeys.forwardTickets("0xv") }),
    );
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: queryKeys.forwardQueue("0xv") });
  });
});
