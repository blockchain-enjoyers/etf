import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { BasketDetail, MeridianApi, SettleGateStatus } from "@meridian/sdk";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0xme", isConnected: true }) }));
vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: () => ({ canForwardCreate: () => ({ enabled: true, reason: "ok" as const }) }),
}));

// useTxPlan — the generic write executor. run() captures the build fetcher.
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

// Cash leg decimals + token come from the forward queue (USDG 18-dec here).
vi.mock("../../../data/useForwardQueue", () => ({
  useForwardQueue: () => ({ data: { cashDecimals: 18, cashToken: "0xusdc" } }),
}));

import { queryKeys } from "../../../lib/query";
import { ForwardCreatePanel } from "../ForwardCreatePanel";

const basket = {
  vaultAddress: "0xv", name: "R", symbol: "R", frozen: false, vaultType: "rebalance",
  basketToken: null, cashToken: "0xusdc", unitSize: "1000000000000000000", constituents: [],
} as unknown as BasketDetail;

const gate: SettleGateStatus = {
  open: true, navPerShare: "1000000000000000000", twap: null, guards: [], estimated: true,
};

const api = { buildForwardCreateTx: vi.fn() } as unknown as MeridianApi;
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
  (api.buildForwardCreateTx as ReturnType<typeof vi.fn>).mockReset();
});

describe("ForwardCreatePanel", () => {
  it("renders an estimate label for the projected shares", () => {
    render(<ForwardCreatePanel vaultAddress="0xv" basket={basket} gate={gate} bootstrapped={true} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByLabelText(/estimated/i)).toBeInTheDocument();
  });

  it("seeds useTxPlan with the basket cash token as the allowlist", () => {
    render(<ForwardCreatePanel vaultAddress="0xv" basket={basket} gate={gate} bootstrapped={true} />, {
      wrapper: makeWrapper(),
    });
    expect(mockUseTxPlan).toHaveBeenCalledWith(["0xusdc"]);
  });

  it("queue create runs a buildForwardCreateTx fetcher with the cash token's (18-dec) base units", async () => {
    const user = userEvent.setup();
    render(<ForwardCreatePanel vaultAddress="0xv" basket={basket} gate={gate} bootstrapped={true} />, {
      wrapper: makeWrapper(),
    });
    await user.clear(screen.getByLabelText(/usdg amount/i));
    await user.type(screen.getByLabelText(/usdg amount/i), "1");
    await user.click(screen.getByRole("button", { name: /queue create/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildForwardCreateTx).toHaveBeenCalledWith("0xv", { cash: "1000000000000000000", account: "0xme" });
  });

  it("invalidates the forward queries after the create resolves", async () => {
    const user = userEvent.setup();
    render(<ForwardCreatePanel vaultAddress="0xv" basket={basket} gate={gate} bootstrapped={true} />, {
      wrapper: makeWrapper(),
    });
    await user.type(screen.getByLabelText(/usdg amount/i), "1");
    await user.click(screen.getByRole("button", { name: /queue create/i }));
    await waitFor(() =>
      expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: queryKeys.forwardTickets("0xv") }),
    );
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: queryKeys.forwardQueue("0xv") });
  });
});
