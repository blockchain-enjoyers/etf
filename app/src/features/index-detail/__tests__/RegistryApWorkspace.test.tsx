import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { BasketDetail, ForwardQueue, MeridianApi } from "@meridian/sdk";

// useTxPlan — the generic write executor. run() captures the build fetcher we assert against.
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

const mockUseForwardQueue = vi.fn(() => ({ data: undefined as unknown }));
vi.mock("../../../data/useForwardQueue", () => ({
  useForwardQueue: (...args: unknown[]) => mockUseForwardQueue(...(args as [])),
}));

const mockUseAccount = vi.fn(() => ({ address: "0xme", isConnected: true }) as unknown);
vi.mock("wagmi", () => ({
  useAccount: () => mockUseAccount(),
  useChainId: () => 46630,
}));

// 46630 (Robinhood Chain testnet) carries a CloneFactory in the static address book → "wired".
vi.mock("@meridian/contracts", () => ({
  addresses: { 46630: { CloneFactory: "0xfactory" } },
}));

import { RegistryApWorkspace } from "../workspaces/RegistryApWorkspace";
import { queryKeys } from "../../../lib/query";

const VAULT = "0xv";
const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";

const registryBasket: BasketDetail = {
  vaultAddress: VAULT,
  name: "Registry Fund",
  symbol: "RGX",
  frozen: false,
  vaultType: "registry",
  basketToken: null,
  cashToken: "0xusdc",
  unitSize: "1000000000000000000",
  constituents: [
    { token: TOKEN_A, unitQty: "500000000000000000", symbol: "AAPL" },
    { token: TOKEN_B, unitQty: "300000000000000000", symbol: "MSFT" },
  ],
  manager: "0xmgr",
};

const queue: ForwardQueue = {
  queueAddress: "0x9999999999999999999999999999999999999999",
  tickets: [],
  capacity: {
    maxCreateFlowBps: 250,
    windowCapShares: "5000000000000000000",
    pendingCreateCash: "0",
    pendingRedeemShares: "0",
  },
};

const api = {
  buildWrapTx: vi.fn(),
  buildUnwrapTx: vi.fn(),
  buildRegistryCreateTx: vi.fn(),
  buildRegistryRedeemTx: vi.fn(),
  buildSetOperatorTx: vi.fn(),
} as unknown as MeridianApi;

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.invalidateQueries = vi.fn() as never;
  return render(
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <RegistryApWorkspace vaultAddress={VAULT} basket={registryBasket} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue(undefined);
  mockUseTxPlan.mockReset();
  mockUseTxPlan.mockImplementation(() => txDefaults());
  mockUseForwardQueue.mockReset();
  mockUseForwardQueue.mockImplementation(() => ({ data: queue }));
  mockUseAccount.mockReset();
  mockUseAccount.mockReturnValue({ address: "0xme", isConnected: true });
  (api.buildWrapTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildUnwrapTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildRegistryCreateTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildRegistryRedeemTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildSetOperatorTx as ReturnType<typeof vi.fn>).mockReset();
});

describe("RegistryApWorkspace", () => {
  it("renders the AP intro and all five claim-lifecycle modules", () => {
    renderWorkspace();
    expect(screen.getByRole("heading", { name: /Authorized Participant/i })).toBeInTheDocument();
    // Each module is proven by its unique action button (the module title also appears on the
    // button label, so assert the buttons to stay unambiguous).
    expect(screen.getByRole("button", { name: /wrap token into claim/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unwrap claim into token/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create shares in-kind/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /redeem shares in-kind/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set operator authorization/i })).toBeInTheDocument();
    expect(screen.getByText("Create in-kind")).toBeInTheDocument();
  });

  it("Wrap calls buildWrapTx with the selected token + 18-dec base units", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.type(screen.getByLabelText("wrap amount"), "1.5");
    await user.click(screen.getByRole("button", { name: /wrap token into claim/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    mockRun.mock.calls[0]![0]();
    expect(api.buildWrapTx).toHaveBeenCalledWith(VAULT, {
      account: "0xme",
      token: TOKEN_A,
      amount: "1500000000000000000",
    });
  });

  it("Unwrap calls buildUnwrapTx and defaults the recipient to the connected wallet", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.type(screen.getByLabelText("unwrap amount"), "2");
    await user.click(screen.getByRole("button", { name: /unwrap claim into token/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    mockRun.mock.calls[0]![0]();
    expect(api.buildUnwrapTx).toHaveBeenCalledWith(VAULT, {
      account: "0xme",
      token: TOKEN_A,
      amount: "2000000000000000000",
      to: "0xme",
    });
  });

  it("In-kind create calls buildRegistryCreateTx with the share count in base units", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.type(screen.getByLabelText("create shares"), "3");
    await user.click(screen.getByRole("button", { name: /create shares in-kind/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    mockRun.mock.calls[0]![0]();
    expect(api.buildRegistryCreateTx).toHaveBeenCalledWith(VAULT, {
      account: "0xme",
      nShares: "3000000000000000000",
    });
  });

  it("In-kind redeem calls buildRegistryRedeemTx with withUnwrap=true by default", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.type(screen.getByLabelText("redeem shares"), "4");
    await user.click(screen.getByRole("button", { name: /redeem shares in-kind/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    mockRun.mock.calls[0]![0]();
    expect(api.buildRegistryRedeemTx).toHaveBeenCalledWith(VAULT, {
      account: "0xme",
      amount: "4000000000000000000",
      withUnwrap: true,
    });
  });

  it("redeem honors unchecking 'unwrap' (withUnwrap=false)", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.type(screen.getByLabelText("redeem shares"), "4");
    await user.click(screen.getByLabelText("unwrap claims to ERC-20"));
    await user.click(screen.getByRole("button", { name: /redeem shares in-kind/i }));

    mockRun.mock.calls[0]![0]();
    expect(api.buildRegistryRedeemTx).toHaveBeenCalledWith(VAULT, {
      account: "0xme",
      amount: "4000000000000000000",
      withUnwrap: false,
    });
  });

  it("Authorize operator defaults to the forward queue and calls buildSetOperatorTx (approved=true)", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: /set operator authorization/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    mockRun.mock.calls[0]![0]();
    expect(api.buildSetOperatorTx).toHaveBeenCalledWith(VAULT, {
      account: "0xme",
      operator: queue.queueAddress,
      approved: true,
    });
  });

  it("operator Revoke flips approved to false", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: /^Revoke$/ }));
    await user.click(screen.getByRole("button", { name: /set operator authorization/i }));

    mockRun.mock.calls[0]![0]();
    expect(api.buildSetOperatorTx).toHaveBeenCalledWith(VAULT, {
      account: "0xme",
      operator: queue.queueAddress,
      approved: false,
    });
  });

  it("does not submit when the amount is empty (no tx.run)", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: /wrap token into claim/i }));
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("seeds the wrap tx-plan allowlist with the token + vault clone", () => {
    renderWorkspace();
    expect(mockUseTxPlan).toHaveBeenCalledWith([TOKEN_A, VAULT]);
  });

  it("invalidates the basket query after a wrap resolves", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.fn();
    qc.invalidateQueries = invalidate as never;
    render(
      <QueryClientProvider client={qc}>
        <ApiContext.Provider value={api}>
          <RegistryApWorkspace vaultAddress={VAULT} basket={registryBasket} />
        </ApiContext.Provider>
      </QueryClientProvider>,
    );
    await user.type(screen.getByLabelText("wrap amount"), "1");
    await user.click(screen.getByRole("button", { name: /wrap token into claim/i }));
    // mockRun resolves immediately; the .then runs the invalidation.
    await Promise.resolve();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.basket(VAULT) });
  });

  it("gates every action behind a GateBanner when the wallet is disconnected", () => {
    mockUseAccount.mockReturnValue({ address: undefined, isConnected: false });
    renderWorkspace();
    expect(screen.getAllByText(/No wallet attached/i).length).toBeGreaterThan(0);
    // The action buttons render disabled (locked) — wrap can't be submitted.
    expect(screen.getByRole("button", { name: /wrap token into claim/i })).toBeDisabled();
  });
});
