import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import { RebalancePanel } from "../RebalancePanel";
import type { MeridianApi, RebalanceDetail } from "@meridian/sdk";

vi.mock("wagmi", () => ({ useAccount: () => ({ address: "0xmgr", isConnected: true }) }));

vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: vi.fn(() => ({
    canCurate: (_manager: string) => ({ enabled: true, reason: "ok" as const }),
  })),
}));

const mockRun = vi.fn();
type TxPlanShape = {
  run: typeof mockRun;
  status: "idle" | "running" | "success" | "error";
  currentStep: number;
  total: number;
  error: string | null;
  steps: { label: string }[];
};
const txDefaults = (): TxPlanShape => ({
  run: mockRun,
  status: "idle",
  currentStep: 0,
  total: 0,
  error: null,
  steps: [],
});
const mockUseTxPlan = vi.fn((_seed?: string[]) => txDefaults());
vi.mock("../../../wallet/use-tx-plan", () => ({
  useTxPlan: (seed?: string[]) => mockUseTxPlan(seed),
}));

import { useCapabilities } from "../../../capabilities/use-capabilities";

const TOKEN = "0x1111111111111111111111111111111111111111";

const base: RebalanceDetail = {
  vaultAddress: "0xv",
  heldTokens: [],
  target: [],
  pendingTarget: null,
  lastRebalanceAtMs: null,
  drift: null,
};

const api = {
  buildCuratorScheduleTx: vi.fn(),
  buildCuratorActivateTx: vi.fn(),
} as unknown as MeridianApi;
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
  (api.buildCuratorScheduleTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildCuratorActivateTx as ReturnType<typeof vi.fn>).mockReset();
  vi.mocked(useCapabilities).mockReturnValue({
    canCurate: () => ({ enabled: true, reason: "ok" }),
  } as unknown as ReturnType<typeof useCapabilities>);
});

describe("RebalancePanel — section title", () => {
  it("renders Curator header", () => {
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });
    expect(screen.getByText(/curator/i)).toBeInTheDocument();
  });

  it("seeds useTxPlan with the vault clone (curator targets the vault)", () => {
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });
    expect(mockUseTxPlan).toHaveBeenCalledWith(["0xv"]);
  });
});

describe("RebalancePanel — pending target / activate", () => {
  it("disables activate until effectiveAt is past; enables when elapsed", () => {
    const { rerender } = render(
      <RebalancePanel
        vaultAddress="0xv"
        manager="0xmgr"
        detail={{
          ...base,
          pendingTarget: {
            tokens: [{ token: TOKEN, unitQty: "1" }],
            effectiveAtMs: Date.now() + 100000,
          },
        }}
      />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByRole("button", { name: /activate/i })).toBeDisabled();

    rerender(
      <RebalancePanel
        vaultAddress="0xv"
        manager="0xmgr"
        detail={{
          ...base,
          pendingTarget: {
            tokens: [{ token: TOKEN, unitQty: "1" }],
            effectiveAtMs: Date.now() - 1000,
          },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /activate/i })).not.toBeDisabled();
  });

  it("shows 'Ready to activate' when timelock has elapsed", () => {
    render(
      <RebalancePanel
        vaultAddress="0xv"
        manager="0xmgr"
        detail={{
          ...base,
          pendingTarget: {
            tokens: [{ token: TOKEN, unitQty: "1000000000000000000" }],
            effectiveAtMs: Date.now() - 1000,
          },
        }}
      />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByText(/ready to activate/i)).toBeInTheDocument();
  });

  it("shows 'Activates in' countdown when timelock is pending", () => {
    render(
      <RebalancePanel
        vaultAddress="0xv"
        manager="0xmgr"
        detail={{
          ...base,
          pendingTarget: {
            tokens: [{ token: TOKEN, unitQty: "1000000000000000000" }],
            effectiveAtMs: Date.now() + 3_700_000,
          },
        }}
      />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByText(/activates in/i)).toBeInTheDocument();
  });

  it("runs a buildCuratorActivateTx fetcher when activate is clicked", async () => {
    const user = userEvent.setup();
    render(
      <RebalancePanel
        vaultAddress="0xv"
        manager="0xmgr"
        detail={{
          ...base,
          pendingTarget: {
            tokens: [{ token: TOKEN, unitQty: "1" }],
            effectiveAtMs: Date.now() - 1000,
          },
        }}
      />,
      { wrapper: makeWrapper() },
    );
    await user.click(screen.getByRole("button", { name: /activate/i }));
    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildCuratorActivateTx).toHaveBeenCalledWith("0xv", { account: "0xmgr" });
  });

  it("does not render pending section when pendingTarget is null", () => {
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });
    expect(screen.queryByRole("button", { name: /activate/i })).not.toBeInTheDocument();
  });
});

describe("RebalancePanel — gate / GateBanner", () => {
  it("shows GateBanner when not the manager", () => {
    vi.mocked(useCapabilities).mockReturnValue({
      canCurate: () => ({ enabled: false, reason: "manager-mismatch" }),
    } as unknown as ReturnType<typeof useCapabilities>);

    render(
      <RebalancePanel
        vaultAddress="0xv"
        manager="0xmgr"
        detail={{
          ...base,
          pendingTarget: {
            tokens: [{ token: TOKEN, unitQty: "1" }],
            effectiveAtMs: Date.now() - 1000,
          },
        }}
      />,
      { wrapper: makeWrapper() },
    );

    expect(screen.getByText(/manager-only tool/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in as the index manager/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /activate/i })).toBeDisabled();
  });
});

describe("RebalancePanel — schedule form", () => {
  it("renders Schedule new target button", () => {
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });
    expect(screen.getByRole("button", { name: /schedule new target/i })).toBeInTheDocument();
  });

  it("disables Schedule button when gate is disabled", () => {
    vi.mocked(useCapabilities).mockReturnValue({
      canCurate: () => ({ enabled: false, reason: "manager-mismatch" }),
    } as unknown as ReturnType<typeof useCapabilities>);
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });
    expect(screen.getByRole("button", { name: /schedule new target/i })).toBeDisabled();
  });

  it("runs a buildCuratorScheduleTx fetcher with entered address + parseUnits qty strings", async () => {
    const user = userEvent.setup();
    const ADDRESS = "0xabcdef1234567890abcdef1234567890abcdef12";
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });

    await user.clear(screen.getByRole("textbox", { name: /token address row 1/i }));
    await user.type(screen.getByRole("textbox", { name: /token address row 1/i }), ADDRESS);
    await user.clear(screen.getByRole("textbox", { name: /unit qty row 1/i }));
    await user.type(screen.getByRole("textbox", { name: /unit qty row 1/i }), "2");

    await user.click(screen.getByRole("button", { name: /schedule new target/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildCuratorScheduleTx).toHaveBeenCalledWith("0xv", {
      tokens: [ADDRESS],
      unitQty: ["2000000000000000000"],
      account: "0xmgr",
    });
  });
});

describe("RebalancePanel — transaction feedback", () => {
  it("shows the current step label + progress while a plan runs", () => {
    mockUseTxPlan.mockReturnValue({
      ...txDefaults(),
      status: "running",
      currentStep: 0,
      total: 1,
      steps: [{ label: "Schedule target" }],
    });
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });
    expect(screen.getByText("Schedule target")).toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  it("shows 'Confirmed ✓' on success", () => {
    mockUseTxPlan.mockReturnValue({ ...txDefaults(), status: "success" });
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
  });

  it("surfaces a plan error", () => {
    mockUseTxPlan.mockReturnValue({ ...txDefaults(), status: "error", error: "user rejected" });
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });
    expect(screen.getByText(/Failed: user rejected/i)).toBeInTheDocument();
  });

  it("disables the schedule button while a plan runs", () => {
    mockUseTxPlan.mockReturnValue({ ...txDefaults(), status: "running" });
    render(<RebalancePanel vaultAddress="0xv" manager="0xmgr" detail={base} />, { wrapper: makeWrapper() });
    expect(screen.getByRole("button", { name: /schedule new target/i })).toBeDisabled();
  });
});
