import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import { OrderRail } from "../OrderRail";
import type { BasketDetail, MeridianApi, MintQuoteResponse, NavResponse } from "@meridian/sdk";

const capsMintDisabled = {
  canMint: (_v: string) => ({ enabled: false, reason: "not-deployed" as const }),
  canRedeemInKind: () => ({ enabled: true, reason: "ok" as const }),
  canRedeemCash: () => ({ enabled: true, reason: "ok" as const }),
  canForwardCreate: () => ({ enabled: true, reason: "ok" as const }),
  canForwardRedeem: () => ({ enabled: true, reason: "ok" as const }),
  canDeploy: () => ({ enabled: false, reason: "not-deployed" as const }),
  status: () => "absent" as const,
};
const capsMintEnabled = {
  canMint: () => ({ enabled: true, reason: "ok" as const }),
  canRedeemInKind: () => ({ enabled: true, reason: "ok" as const }),
  canRedeemCash: () => ({ enabled: true, reason: "ok" as const }),
  canForwardCreate: () => ({ enabled: true, reason: "ok" as const }),
  canForwardRedeem: () => ({ enabled: true, reason: "ok" as const }),
  canDeploy: () => ({ enabled: false, reason: "not-deployed" as const }),
  status: () => "present" as const,
};
const mockUseCapabilities = vi.fn(
  (_marketStatus?: unknown) => capsMintDisabled as typeof capsMintDisabled | typeof capsMintEnabled,
);
vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: (marketStatus: unknown) => mockUseCapabilities(marketStatus),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xme", isConnected: true }),
}));

// useTxPlan — the generic write executor. run() captures the fetcher + finalize fetcher.
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
const mockUseTxPlan = vi.fn((_tokens?: string[]) => txDefaults());
vi.mock("../../../wallet/use-tx-plan", () => ({
  useTxPlan: (tokens?: string[]) => mockUseTxPlan(tokens),
}));

// useMintQuote — backend-computed deposit set (token/symbol/amount/valueUsd) + gate.
const sampleDeposits: MintQuoteResponse["deposits"] = [
  { token: "0x1111111111111111111111111111111111111111", symbol: "AAPL", amount: "500000000000000000", valueUsd: "90000000000000000000" },
];
const mintQuoteData = (): MintQuoteResponse => ({
  unitsOut: "1",
  deposits: sampleDeposits,
  estTotalUsd: "90000000000000000000",
  gate: { gated: false, reason: "none" },
});
const mockUseMintQuote = vi.fn(() => ({ data: mintQuoteData(), isLoading: false, refetch: vi.fn() }));
vi.mock("../../../data/useMintQuote", () => ({
  useMintQuote: (...args: unknown[]) => mockUseMintQuote(...(args as [])),
}));

// Forward-queue (registry fees) + settle-gate (navPerShare / bootstrapped guard) — registry-only.
const mockUseForwardQueue = vi.fn(() => ({ data: undefined as unknown }));
vi.mock("../../../data/useForwardQueue", () => ({
  useForwardQueue: (...args: unknown[]) => mockUseForwardQueue(...(args as [])),
}));
const mockUseSettleGateStatus = vi.fn(() => ({ data: undefined as unknown }));
vi.mock("../../../data/useSettleGateStatus", () => ({
  useSettleGateStatus: (...args: unknown[]) => mockUseSettleGateStatus(...(args as [])),
}));

const basket: BasketDetail = {
  vaultAddress: "0xabc",
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
  vaultAddress: "0xabc",
  nav: "100000000000000000000",
  confidenceLower: "99000000000000000000",
  confidenceUpper: "101000000000000000000",
  marketStatus: "regular",
  estimated: false,
  source: "chainlink",
  timestampMs: Date.now(),
};

const closedNav: NavResponse = {
  ...openNav,
  marketStatus: "closed",
  estimated: true,
};

const haltNav: NavResponse = {
  ...openNav,
  marketStatus: "unknown",
  estimated: true,
};

const api = {
  buildMintTx: vi.fn(),
  finalizeMintTx: vi.fn(),
  buildRedeemTx: vi.fn(),
  buildForwardRedeemTx: vi.fn(),
  buildForwardCreateTx: vi.fn(),
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
  mockUseMintQuote.mockReset();
  mockUseMintQuote.mockImplementation(() => ({ data: mintQuoteData(), isLoading: false, refetch: vi.fn() }));
  mockUseForwardQueue.mockReset();
  mockUseForwardQueue.mockImplementation(() => ({ data: undefined }));
  mockUseSettleGateStatus.mockReset();
  mockUseSettleGateStatus.mockImplementation(() => ({ data: undefined }));
  mockUseCapabilities.mockReset();
  mockUseCapabilities.mockReturnValue(capsMintDisabled as never);
  (api.buildMintTx as ReturnType<typeof vi.fn>).mockReset();
  (api.finalizeMintTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildRedeemTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildForwardRedeemTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildForwardCreateTx as ReturnType<typeof vi.fn>).mockReset();
});

describe("OrderRail — iron rules", () => {
  it("renders Create and Redeem tabs", () => {
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByRole("button", { name: "Buy / Mint" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redeem" })).toBeInTheDocument();
  });

  it("shows not-deployed hint on Mint button when minting is gated", () => {
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    const mintBtn = screen.getByRole("button", { name: /mint basket tokens/i });
    expect(mintBtn).toBeDisabled();
    expect(screen.getByText(/isn't deployed yet/i)).toBeInTheDocument();
  });

  it("switches to Redeem tab on click", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    expect(screen.getByLabelText(/redeem amount/i)).toBeInTheDocument();
  });

  it("IRON RULE: in-kind Redeem button is enabled for open market", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    expect(screen.getByRole("button", { name: /redeem basket tokens/i })).not.toBeDisabled();
  });

  it("IRON RULE: in-kind Redeem button is enabled even when market is closed", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={closedNav} />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    expect(screen.getByRole("button", { name: /redeem basket tokens/i })).not.toBeDisabled();
  });

  it("IRON RULE: in-kind Redeem button is enabled even during halt", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={haltNav} />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    expect(screen.getByRole("button", { name: /redeem basket tokens/i })).not.toBeDisabled();
  });

  it("shows queued cash copy when market is closed and Cash method is selected (rebalance)", async () => {
    const user = userEvent.setup();
    const rebalanceBasket: BasketDetail = { ...basket, vaultType: "rebalance" };
    render(<OrderRail vaultAddress="0xabc" basket={rebalanceBasket} nav={closedNav} />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    expect(screen.getByText(/settles next open at open price, not estimate/i)).toBeInTheDocument();
  });

  it("shows no ~est in Create breakdown for live open NAV", () => {
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.queryAllByText(/~est/i)).toHaveLength(0);
  });

  it("shows ~est in Create breakdown when nav.estimated is true", () => {
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={closedNav} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getAllByText(/~est/i).length).toBeGreaterThan(0);
  });
});

describe("OrderRail — deposit list from mint-quote", () => {
  beforeEach(() => {
    mockUseCapabilities.mockReturnValue(capsMintEnabled as never);
  });

  it("renders the deposit list from the mint-quote (symbol + amount + ≈$)", () => {
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    // amount 0.5 (18-dec) formatted by formatQty, value ≈ $90 from valueUsd.
    expect(screen.getByText(/≈\$90\.00/)).toBeInTheDocument();
  });

  it("passes the unit-count units string + account to the mint-quote", () => {
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    // default units = 1 → "1"; account from useAccount.
    expect(mockUseMintQuote).toHaveBeenCalledWith("0xabc", "1", "0xme");
  });

  it("seeds useTxPlan with the vault clone + deposit tokens as the allowlist", () => {
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    // The vault clone is the create-step `to` and must be allowlisted alongside the deposit tokens.
    expect(mockUseTxPlan).toHaveBeenCalledWith(["0xabc", sampleDeposits[0]!.token]);
  });

  it("shows $0.00 create fee when the mint-quote carries no fee (Basket/no-op seam)", () => {
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText(/create fee/i)).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    // flow fee headline stays 0%.
    expect(screen.getByText(/flow fee/i)).toBeInTheDocument();
  });

  it("shows the flat USDG create fee (valueUsd + amount + symbol) when the mint-quote carries one", () => {
    mockUseMintQuote.mockReturnValue({
      data: {
        ...mintQuoteData(),
        fee: { token: "0xusdg", symbol: "USDG", amount: "2500000", valueUsd: "2500000000000000000" },
      },
      isLoading: false,
      refetch: vi.fn(),
    } as never);
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText(/\$2\.50/)).toBeInTheDocument();
    expect(screen.getByText(/in USDG/)).toBeInTheDocument();
  });
});

describe("OrderRail — mint via tx-plan executor", () => {
  beforeEach(() => {
    mockUseCapabilities.mockReturnValue(capsMintEnabled as never);
  });

  it("clicking Mint calls tx.run with a build fetcher and a finalize fetcher", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });

    await user.click(screen.getByRole("button", { name: /mint basket tokens/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher, finalizeFetcher] = mockRun.mock.calls[0]!;
    expect(typeof fetcher).toBe("function");
    expect(typeof finalizeFetcher).toBe("function");

    // The build fetcher hits buildMintTx with the unit-count units string.
    fetcher();
    expect(api.buildMintTx).toHaveBeenCalledWith("0xabc", { account: "0xme", units: "1" });

    // The finalize fetcher forwards posted permits to finalizeMintTx.
    const permits = [{ token: "0x1", value: "1", deadline: "9", v: 27, r: "0x1", s: "0x2" }];
    finalizeFetcher(permits);
    expect(api.finalizeMintTx).toHaveBeenCalledWith("0xabc", { account: "0xme", units: "1", permits });
  });

  it("shows the current step label + progress while a plan runs", () => {
    mockUseTxPlan.mockReturnValue({
      ...txDefaults(),
      status: "running",
      currentStep: 0,
      total: 2,
      steps: [{ label: "Approve AAPL" }, { label: "Mint TECH" }],
    });
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText("Approve AAPL")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("surfaces a plan error", () => {
    mockUseTxPlan.mockReturnValue({ ...txDefaults(), status: "error", error: "user rejected" });
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText(/Failed: user rejected/i)).toBeInTheDocument();
  });
});

describe("OrderRail — redeem via tx-plan executor", () => {
  beforeEach(() => {
    mockUseCapabilities.mockReturnValue(capsMintEnabled as never);
  });

  it("clicking Redeem calls tx.run with a buildRedeemTx fetcher (amount in base units)", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });

    await user.click(screen.getByRole("button", { name: "Redeem" }));
    await user.type(screen.getByLabelText(/redeem amount/i), "2");
    await user.click(screen.getByRole("button", { name: /redeem basket tokens/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    // 2 * 1e18 base units.
    expect(api.buildRedeemTx).toHaveBeenCalledWith("0xabc", {
      account: "0xme",
      amount: "2000000000000000000",
    });
  });

  it("does not call tx.run when the amount is empty", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    await user.click(screen.getByRole("button", { name: /redeem basket tokens/i }));
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("hides the cash method for a static (basket) vault — in-kind only", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={basket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    expect(screen.queryByText(/cash \(usdg\)/i)).not.toBeInTheDocument();
  });

  it("shows the cash method for a rebalance vault", async () => {
    const user = userEvent.setup();
    const rebalanceBasket: BasketDetail = { ...basket, vaultType: "rebalance" };
    render(<OrderRail vaultAddress="0xabc" basket={rebalanceBasket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    expect(screen.getByText(/cash \(usdg\)/i)).toBeInTheDocument();
  });

  it("clicking cash on a rebalance vault runs a buildForwardRedeemTx fetcher (not buildRedeemTx)", async () => {
    const user = userEvent.setup();
    const rebalanceBasket: BasketDetail = { ...basket, vaultType: "rebalance" };
    render(<OrderRail vaultAddress="0xabc" basket={rebalanceBasket} nav={openNav} />, {
      wrapper: makeWrapper(),
    });

    await user.click(screen.getByRole("button", { name: "Redeem" }));
    await user.click(screen.getByText(/cash \(usdg\)/i));
    await user.type(screen.getByLabelText(/redeem amount/i), "2");
    await user.click(screen.getByRole("button", { name: /redeem basket tokens/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    // Cash routes through the forward queue: 2 * 1e18 shares.
    expect(api.buildForwardRedeemTx).toHaveBeenCalledWith("0xabc", {
      account: "0xme",
      shares: "2000000000000000000",
    });
    expect(api.buildRedeemTx).not.toHaveBeenCalled();
  });
});

describe("OrderRail — registry vault routes to forward cash", () => {
  const registryBasket: BasketDetail = {
    ...basket,
    vaultType: "registry",
    cashToken: "0x9999999999999999999999999999999999999999",
  };
  const queueWithFees = {
    fees: { isRegistry: true, feeToken: "0xusdg", flatCreateFee: "5000000", flatRedeemFee: "3000000" },
  };
  const gateWithNav = { navPerShare: "1000000000000000000", guards: [{ id: "g0", ok: true }] };

  beforeEach(() => {
    mockUseCapabilities.mockReturnValue(capsMintEnabled as never);
    mockUseForwardQueue.mockImplementation(() => ({ data: queueWithFees }));
    mockUseSettleGateStatus.mockImplementation(() => ({ data: gateWithNav }));
  });

  it("shows the Forward cash header tag (not In-kind mint)", () => {
    render(<OrderRail vaultAddress="0xabc" basket={registryBasket} nav={openNav} />, { wrapper: makeWrapper() });
    expect(screen.getByText(/forward cash/i)).toBeInTheDocument();
    expect(screen.queryByText(/in-kind mint/i)).not.toBeInTheDocument();
  });

  it("Create rail takes USDG cash-in and hides the in-kind mint button", () => {
    render(<OrderRail vaultAddress="0xabc" basket={registryBasket} nav={openNav} />, { wrapper: makeWrapper() });
    expect(screen.getByLabelText(/usdg amount/i)).toBeInTheDocument();
    // The in-kind mint button must not exist for registry.
    expect(screen.queryByRole("button", { name: /mint basket tokens/i })).not.toBeInTheDocument();
    // The flat USDG create fee from the queue DTO is disclosed (5.00 USDG).
    expect(screen.getByText(/\+ \$5\.00 USDG/i)).toBeInTheDocument();
  });

  it("clicking cash create routes to buildForwardCreateTx with 6-dec USDG base units", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={registryBasket} nav={openNav} />, { wrapper: makeWrapper() });
    await user.type(screen.getByLabelText(/usdg amount/i), "1");
    await user.click(screen.getByRole("button", { name: /queue cash create/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildForwardCreateTx).toHaveBeenCalledWith("0xabc", { cash: "1000000", account: "0xme" });
    expect(api.buildMintTx).not.toHaveBeenCalled();
  });

  it("Redeem is cash-only (no in-kind option) and discloses the flat redeem fee", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={registryBasket} nav={openNav} />, { wrapper: makeWrapper() });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    // No in-kind method offered; the queued-cash label is shown.
    expect(screen.queryByText(/in-kind · instant/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cash · forward queue/i)).toBeInTheDocument();
    expect(screen.getByText(/net − \$3\.00 USDG/i)).toBeInTheDocument();
  });

  it("clicking redeem on a registry vault routes to buildForwardRedeemTx (cash), not buildRedeemTx", async () => {
    const user = userEvent.setup();
    render(<OrderRail vaultAddress="0xabc" basket={registryBasket} nav={openNav} />, { wrapper: makeWrapper() });
    await user.click(screen.getByRole("button", { name: "Redeem" }));
    await user.type(screen.getByLabelText(/redeem amount/i), "2");
    await user.click(screen.getByRole("button", { name: /redeem basket tokens/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildForwardRedeemTx).toHaveBeenCalledWith("0xabc", { account: "0xme", shares: "2000000000000000000" });
    expect(api.buildRedeemTx).not.toHaveBeenCalled();
  });
});
