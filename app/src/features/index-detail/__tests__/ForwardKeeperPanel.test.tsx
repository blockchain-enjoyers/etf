import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { ForwardTicket, MeridianApi } from "@meridian/sdk";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0xmgr", isConnected: true }) }));
vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: () => ({ canForwardKeeper: () => ({ enabled: true, reason: "ok" as const }) }),
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

import { ForwardKeeperPanel } from "../ForwardKeeperPanel";

const HELD = ["0xt1"];
function ticket(over: Partial<ForwardTicket>): ForwardTicket {
  return {
    id: 0, vaultAddress: "0xv", owner: "0xo", kind: "create",
    amountRaw: "1", remainingRaw: "1", status: "pending",
    cutoffMs: Date.now() - 1000, createdAtMs: 0, ...over,
  };
}

const api = {
  buildKeeperRecordTx: vi.fn(),
  buildKeeperSettleTx: vi.fn(),
} as unknown as MeridianApi;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  (api.buildKeeperRecordTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildKeeperSettleTx as ReturnType<typeof vi.fn>).mockReset();
});

describe("ForwardKeeperPanel", () => {
  it("record/settle target singletons — no allowlist seed", () => {
    render(<ForwardKeeperPanel vaultAddress="0xv" manager="0xmgr" heldTokens={HELD} tickets={[]} apFiller="0xap" />, {
      wrapper: makeWrapper(),
    });
    expect(mockUseTxPlan).toHaveBeenCalledWith(undefined);
  });

  it("Record runs a buildKeeperRecordTx fetcher", async () => {
    const user = userEvent.setup();
    render(<ForwardKeeperPanel vaultAddress="0xv" manager="0xmgr" heldTokens={HELD} tickets={[]} apFiller="0xap" />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: /record/i }));
    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildKeeperRecordTx).toHaveBeenCalledWith("0xv", { account: "0xmgr" });
  });

  it("Settle runs a buildKeeperSettleTx fetcher with past-cutoff ids + AP filler", async () => {
    const user = userEvent.setup();
    render(
      <ForwardKeeperPanel
        vaultAddress="0xv" manager="0xmgr" heldTokens={HELD}
        tickets={[ticket({ id: 5 })]} apFiller="0xap"
      />,
      { wrapper: makeWrapper() },
    );
    await user.click(screen.getByRole("button", { name: /settle/i }));
    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildKeeperSettleTx).toHaveBeenCalledWith("0xv", {
      ticketIds: [5],
      ap: "0xap",
      account: "0xmgr",
    });
  });

  it("Settle disabled when no past-cutoff tickets", () => {
    render(
      <ForwardKeeperPanel
        vaultAddress="0xv" manager="0xmgr" heldTokens={HELD}
        tickets={[ticket({ id: 6, cutoffMs: Date.now() + 100000 })]} apFiller="0xap"
      />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByRole("button", { name: /settle/i })).toBeDisabled();
  });

  it("Settle disabled while guards block settlement", () => {
    render(
      <ForwardKeeperPanel
        vaultAddress="0xv" manager="0xmgr" heldTokens={HELD}
        tickets={[ticket({ id: 7 })]} apFiller="0xap" guardsBlocked
      />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByRole("button", { name: /settle/i })).toBeDisabled();
  });
});
