import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { ForwardTicket, MeridianApi } from "@meridian/sdk";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0xme", isConnected: true }) }));
vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: () => ({ canForwardCancel: () => ({ enabled: true, reason: "ok" as const }) }),
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

// Cancel targets the per-vault queue clone — the panel seeds it from the queue lookup + reads cash decimals.
vi.mock("../../../data/useForwardQueue", () => ({
  useForwardQueue: () => ({ data: { queueAddress: "0xqueue", cashDecimals: 6 } }),
}));

import { queryKeys } from "../../../lib/query";
import { MyTicketsPanel } from "../MyTicketsPanel";

const api = { buildForwardCancelTx: vi.fn() } as unknown as MeridianApi;
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

function ticket(over: Partial<ForwardTicket>): ForwardTicket {
  return {
    id: 0, vaultAddress: "0xv", owner: "0xme", kind: "create",
    amountRaw: "1000000", remainingRaw: "1000000", status: "pending",
    cutoffMs: Date.now() + 100000, createdAtMs: 0, ...over,
  };
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue(undefined);
  mockUseTxPlan.mockReset();
  mockUseTxPlan.mockImplementation(() => txDefaults());
  mockInvalidate.mockReset();
  (api.buildForwardCancelTx as ReturnType<typeof vi.fn>).mockReset();
});

describe("MyTicketsPanel", () => {
  it("renders empty state when no tickets", () => {
    render(<MyTicketsPanel vaultAddress="0xv" tickets={[]} />, { wrapper: makeWrapper() });
    expect(screen.getByText(/no forward tickets/i)).toBeInTheDocument();
  });

  it("seeds the per-vault queue clone into the cancel allowlist", () => {
    render(<MyTicketsPanel vaultAddress="0xv" tickets={[]} />, { wrapper: makeWrapper() });
    expect(mockUseTxPlan).toHaveBeenCalledWith(["0xqueue"]);
  });

  it("enables Cancel for a pending pre-cutoff ticket and runs a buildForwardCancelTx fetcher", async () => {
    const user = userEvent.setup();
    render(<MyTicketsPanel vaultAddress="0xv" tickets={[ticket({ id: 7 })]} />, { wrapper: makeWrapper() });
    const btn = screen.getByRole("button", { name: /cancel ticket 7/i });
    expect(btn).not.toBeDisabled();
    await user.click(btn);

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildForwardCancelTx).toHaveBeenCalledWith("0xv", { ticketId: 7, account: "0xme" });
  });

  it("disables Cancel for a settled ticket", () => {
    render(<MyTicketsPanel vaultAddress="0xv" tickets={[ticket({ id: 1, status: "settled" })]} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByRole("button", { name: /cancel ticket 1/i })).toBeDisabled();
  });

  it("disables Cancel for a past-cutoff pending ticket", () => {
    render(<MyTicketsPanel vaultAddress="0xv" tickets={[ticket({ id: 2, cutoffMs: Date.now() - 1000 })]} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByRole("button", { name: /cancel ticket 2/i })).toBeDisabled();
  });

  it("invalidates the forward queries after a successful cancel", async () => {
    const user = userEvent.setup();
    render(<MyTicketsPanel vaultAddress="0xv" tickets={[ticket({ id: 3 })]} />, { wrapper: makeWrapper() });
    await user.click(screen.getByRole("button", { name: /cancel ticket 3/i }));
    await waitFor(() =>
      expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: queryKeys.forwardTickets("0xv") }),
    );
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: queryKeys.forwardQueue("0xv") });
  });
});
