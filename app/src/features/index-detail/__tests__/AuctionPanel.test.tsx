import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import { AuctionPanel } from "../AuctionPanel";
import type { MeridianApi } from "@meridian/sdk";

const MANAGER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const VAULT = "0xvault";

// Auction status now comes from the backend hook (useAuctionStatus). Each test sets the
// { deployed, execMode, openAllow, acquireIn } the panel should see.
type AuctionData = {
  deployed: boolean;
  execMode: number;
  openAllow: boolean;
  acquireIn: string[];
};
let auctionData: AuctionData = { deployed: true, execMode: 0, openAllow: false, acquireIn: [] };

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({ address: MANAGER, isConnected: true })),
  useChainId: vi.fn(() => 46630),
}));

vi.mock("../../../data/useAuctionStatus", () => ({
  useAuctionStatus: () => ({ data: auctionData }),
}));

// canCurate must reflect the *connected* account, like the real hook.
let connectedAddress: string = MANAGER;
function curateGate(manager: string) {
  const ok = manager.toLowerCase() === connectedAddress.toLowerCase();
  return { enabled: ok, reason: ok ? ("ok" as const) : ("manager-mismatch" as const) };
}

vi.mock("../../../capabilities/use-capabilities", () => ({
  useCapabilities: vi.fn(() => ({ canCurate: curateGate })),
}));

// useTxPlan — one shared run spy across all executor instances. Each handler calls a distinct
// build*Tx, so assertions key off which SDK method the captured fetcher invokes. The seed passed
// to each instance is inspected via mockUseTxPlan.mock.calls.
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

import { useAccount } from "wagmi";
import { useCapabilities } from "../../../capabilities/use-capabilities";

const api = {
  buildAuctionOpenTx: vi.fn(),
  buildAuctionBidTx: vi.fn(),
  buildAuctionSetExecModeTx: vi.fn(),
} as unknown as MeridianApi;

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

function setAuction(data: Partial<AuctionData>) {
  auctionData = { deployed: true, execMode: 0, openAllow: false, acquireIn: [], ...data };
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue(undefined);
  mockUseTxPlan.mockReset();
  mockUseTxPlan.mockImplementation(() => txDefaults());
  connectedAddress = MANAGER;
  setAuction({ deployed: true, execMode: 0, openAllow: false, acquireIn: [] });
  vi.mocked(useAccount).mockReturnValue({ address: MANAGER, isConnected: true } as unknown as ReturnType<typeof useAccount>);
  vi.mocked(useCapabilities).mockReturnValue({ canCurate: curateGate } as unknown as ReturnType<typeof useCapabilities>);
  (api.buildAuctionOpenTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildAuctionBidTx as ReturnType<typeof vi.fn>).mockReset();
  (api.buildAuctionSetExecModeTx as ReturnType<typeof vi.fn>).mockReset();
});

describe("AuctionPanel — execMode label", () => {
  it("renders Manager-only label for execMode 0", () => {
    setAuction({ execMode: 0 });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    expect(screen.getByTestId("auction-exec-mode").textContent).toMatch(/manager-only/i);
  });

  it("renders Allowlist label for execMode 1", () => {
    setAuction({ execMode: 1 });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    expect(screen.getByTestId("auction-exec-mode").textContent).toMatch(/allowlist/i);
  });

  it("renders Permissionless label for execMode 2", () => {
    setAuction({ execMode: 2 });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    expect(screen.getByTestId("auction-exec-mode").textContent).toMatch(/permissionless/i);
  });

  it("renders an em dash when the auction is not deployed", () => {
    setAuction({ deployed: false });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    expect(screen.getByTestId("auction-exec-mode").textContent).toContain("—");
  });
});

describe("AuctionPanel — open form (canOpen)", () => {
  it("open / setExecMode executors are seeded empty (auction is in the address book)", () => {
    setAuction({ execMode: 0 });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    // open + exec instances both seed [] (called with no arg → undefined).
    expect(mockUseTxPlan).toHaveBeenCalledWith(undefined);
  });

  it("runs a buildAuctionOpenTx fetcher with parsed leg + duration args", async () => {
    const user = userEvent.setup();
    setAuction({ execMode: 0 });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });

    const RELEASE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ACQUIRE = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    await user.type(screen.getByRole("textbox", { name: /release token row 1/i }), RELEASE);
    await user.type(screen.getByRole("textbox", { name: /release amount row 1/i }), "5");
    await user.type(screen.getByRole("textbox", { name: /acquire token row 1/i }), ACQUIRE);
    await user.type(screen.getByRole("textbox", { name: /acquire start row 1/i }), "10");
    await user.type(screen.getByRole("textbox", { name: /acquire end row 1/i }), "8");
    await user.clear(screen.getByRole("spinbutton", { name: /duration/i }));
    await user.type(screen.getByRole("spinbutton", { name: /duration/i }), "600");

    await user.click(screen.getByRole("button", { name: /open auction/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildAuctionOpenTx).toHaveBeenCalledWith(VAULT, {
      account: MANAGER,
      durationSec: 600,
      release: [{ token: RELEASE, releaseOut: "5000000000000000000" }],
      acquire: [{ token: ACQUIRE, startIn: "10000000000000000000", endIn: "8000000000000000000" }],
    });
  });

  it("disables open submit when startIn < endIn (contract requires startIn >= endIn)", async () => {
    const user = userEvent.setup();
    setAuction({ execMode: 0 });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });

    await user.type(screen.getByRole("textbox", { name: /release token row 1/i }), "0xaa");
    await user.type(screen.getByRole("textbox", { name: /release amount row 1/i }), "5");
    await user.type(screen.getByRole("textbox", { name: /acquire token row 1/i }), "0xbb");
    await user.type(screen.getByRole("textbox", { name: /acquire start row 1/i }), "8");
    await user.type(screen.getByRole("textbox", { name: /acquire end row 1/i }), "10");
    await user.clear(screen.getByRole("spinbutton", { name: /duration/i }));
    await user.type(screen.getByRole("spinbutton", { name: /duration/i }), "600");

    expect(screen.getByRole("button", { name: /open auction/i })).toBeDisabled();
  });

  it("disables open submit when acquire start/end amounts are blank (no zero-price auction)", async () => {
    const user = userEvent.setup();
    setAuction({ execMode: 0 });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });

    await user.type(screen.getByRole("textbox", { name: /release token row 1/i }), "0xaa");
    await user.type(screen.getByRole("textbox", { name: /release amount row 1/i }), "5");
    await user.type(screen.getByRole("textbox", { name: /acquire token row 1/i }), "0xbb");
    // start/end deliberately left blank → must NOT be submittable
    await user.clear(screen.getByRole("spinbutton", { name: /duration/i }));
    await user.type(screen.getByRole("spinbutton", { name: /duration/i }), "600");

    expect(screen.getByRole("button", { name: /open auction/i })).toBeDisabled();
  });

  it("disables open submit when a token sits on BOTH release and acquire legs (case-insensitive)", async () => {
    const user = userEvent.setup();
    setAuction({ execMode: 0 });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });

    const SHARED = "0xdddddddddddddddddddddddddddddddddddddddd";

    await user.type(screen.getByRole("textbox", { name: /release token row 1/i }), SHARED);
    await user.type(screen.getByRole("textbox", { name: /release amount row 1/i }), "5");
    // Same address on the acquire leg, upper-cased → contract would revert OverlappingLeg.
    await user.type(screen.getByRole("textbox", { name: /acquire token row 1/i }), SHARED.toUpperCase());
    await user.type(screen.getByRole("textbox", { name: /acquire start row 1/i }), "10");
    await user.type(screen.getByRole("textbox", { name: /acquire end row 1/i }), "8");
    await user.clear(screen.getByRole("spinbutton", { name: /duration/i }));
    await user.type(screen.getByRole("spinbutton", { name: /duration/i }), "600");

    expect(screen.getByRole("button", { name: /open auction/i })).toBeDisabled();
    expect(screen.getByText(/must not share a token/i)).toBeInTheDocument();
  });
});

describe("AuctionPanel — gate", () => {
  it("shows GateBanner when a non-manager views a MANAGER_ONLY auction", () => {
    setAuction({ execMode: 0 });
    connectedAddress = OTHER;
    vi.mocked(useAccount).mockReturnValue({ address: OTHER, isConnected: true } as unknown as ReturnType<typeof useAccount>);
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    expect(screen.getByText(/manager-only tool/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in as the index manager/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open auction/i })).not.toBeInTheDocument();
  });
});

describe("AuctionPanel — bid section", () => {
  it("disables Bid until all entered acquire tokens are filled in", () => {
    // one live acquire amount, token not yet entered
    setAuction({ execMode: 2, acquireIn: ["123"] });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    expect(screen.getByRole("button", { name: /^bid$/i })).toBeDisabled();
  });

  it("seeds the bid executor with the entered acquire tokens and runs buildAuctionBidTx", async () => {
    const user = userEvent.setup();
    const TOKEN = "0xcccccccccccccccccccccccccccccccccccccccc";
    setAuction({ execMode: 2, acquireIn: ["123"] });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });

    await user.type(screen.getByRole("textbox", { name: /bid acquire token 1/i }), TOKEN);
    // The bid executor must be seeded with the acquire token (the bid approves it).
    expect(mockUseTxPlan).toHaveBeenCalledWith([TOKEN]);

    const bidBtn = screen.getByRole("button", { name: /^bid$/i });
    expect(bidBtn).not.toBeDisabled();
    await user.click(bidBtn);

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildAuctionBidTx).toHaveBeenCalledWith(VAULT, {
      account: MANAGER,
      acquire: [{ token: TOKEN, amount: "123" }],
    });
  });

  it("shows the no-active-auction notice when the auction is not deployed", () => {
    setAuction({ deployed: false });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    expect(screen.getByText(/no active auction/i)).toBeInTheDocument();
  });
});

describe("AuctionPanel — manager execMode control", () => {
  it("shows execMode selector to the manager and runs buildAuctionSetExecModeTx on change", async () => {
    const user = userEvent.setup();
    setAuction({ execMode: 0 });
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    const select = screen.getByRole("combobox", { name: /execution mode/i });
    expect(select).toBeInTheDocument();

    await user.selectOptions(select, "2");
    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildAuctionSetExecModeTx).toHaveBeenCalledWith(VAULT, { mode: 2, account: MANAGER });
  });

  it("hides execMode selector from non-managers", () => {
    setAuction({ execMode: 2 });
    connectedAddress = OTHER;
    vi.mocked(useAccount).mockReturnValue({ address: OTHER, isConnected: true } as unknown as ReturnType<typeof useAccount>);
    render(<AuctionPanel vaultAddress={VAULT} manager={MANAGER} />, { wrapper: makeWrapper() });
    expect(screen.queryByRole("combobox", { name: /execution mode/i })).not.toBeInTheDocument();
  });
});
