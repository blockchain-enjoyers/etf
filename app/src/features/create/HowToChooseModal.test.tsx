import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HowToChooseModal, templateRows } from "./HowToChooseModal";
import { ApiContext } from "../../lib/api";
import type { MeridianApi, SuggestedFundsResponse } from "@meridian/sdk";

const catalog: SuggestedFundsResponse = {
  funds: [
    {
      id: "sp500",
      name: "S&P 500",
      category: "broad market",
      recommendedVaultKind: "registry",
      description: "The 500 large-cap US companies (SPY).",
      sampleHoldings: [
        { symbol: "NVDA", weightBps: 842, address: "0xnvda" },
        { symbol: "AAPL", weightBps: 710, address: "0xaapl" },
      ],
      holdingsCount: 442,
      coveragePct: 94.85,
      resolvableTokens: [], // reference-only
    },
    {
      id: "fintech",
      name: "Fintech & Blockchain",
      category: "thematic",
      recommendedVaultKind: "basket",
      description: "Fintech innovators.",
      sampleHoldings: [{ symbol: "AAA", weightBps: 6000, address: "0xaaa" }],
      holdingsCount: 2,
      resolvableTokens: [
        { token: "0xaaa", symbol: "AAA", weightBps: 6000 },
        { token: "0xbbb", symbol: "BBB", weightBps: 4000 },
      ],
    },
  ],
};

function makeApi(over: Partial<MeridianApi> = {}): MeridianApi {
  return { getSuggestedFunds: vi.fn(async () => catalog), ...over } as unknown as MeridianApi;
}

function renderModal(props: Partial<React.ComponentProps<typeof HowToChooseModal>> = {}, api: MeridianApi = makeApi()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <HowToChooseModal open onClose={vi.fn()} onPick={vi.fn()} {...props} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

describe("HowToChooseModal", () => {
  it("renders questions and the comparison table when open", () => {
    renderModal();
    expect(screen.getByText(/constant proportions/i)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /registry/i })).toBeInTheDocument();
  });

  it("picks 'registry' from the large-index question", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    renderModal({ onPick });
    await user.click(screen.getByRole("button", { name: /registry index, cash in\/out/i }));
    expect(onPick).toHaveBeenCalledWith("registry");
  });

  it("picks a kind and closes when an answer is chosen", async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal({ onPick, onClose });
    await user.click(screen.getByRole("button", { name: /hold target weights/i }));
    expect(onPick).toHaveBeenCalledWith("rebalance");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("lists fund examples with name, recommended-kind badge, and sample holdings", async () => {
    renderModal();
    expect(await screen.findByText("S&P 500")).toBeInTheDocument();
    const examples = screen.getByRole("region", { name: /fund examples/i });
    // Recommended-kind badge for the registry-scale fund.
    expect(examples).toHaveTextContent(/Registry/);
    // Sample holding chip.
    expect(examples).toHaveTextContent(/NVDA/);
    // Full count beyond the shown sample.
    expect(examples).toHaveTextContent(/\+440 more/);
  });

  it("offers 'Use as starting point' only for funds with resolvable tokens, pre-filling the wizard", async () => {
    const onUseTemplate = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal({ onUseTemplate, onClose });

    await screen.findByText("Fintech & Blockchain");
    const buttons = screen.getAllByRole("button", { name: /use as starting point/i });
    // Only the fintech fund resolves (the S&P 500 example is reference-only).
    expect(buttons).toHaveLength(1);
    expect(screen.getByText(/reference only/i)).toBeInTheDocument();

    await user.click(buttons[0]!);
    expect(onUseTemplate).toHaveBeenCalledWith("basket", [
      { token: "0xaaa", amount: "60.00" },
      { token: "0xbbb", amount: "40.00" },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it("hides the pre-fill action when no onUseTemplate handler is supplied", async () => {
    renderModal({ onUseTemplate: undefined });
    await screen.findByText("Fintech & Blockchain");
    expect(screen.queryByRole("button", { name: /use as starting point/i })).not.toBeInTheDocument();
  });
});

describe("templateRows", () => {
  it("renormalizes resolvable weights to percentages summing to 100", () => {
    const rows = templateRows([
      { token: "0xa", symbol: "A", weightBps: 3000 },
      { token: "0xb", symbol: "B", weightBps: 1000 },
    ]);
    expect(rows).toEqual([
      { token: "0xa", amount: "75.00" },
      { token: "0xb", amount: "25.00" },
    ]);
  });

  it("emits blank amounts when total weight is zero", () => {
    const rows = templateRows([{ token: "0xa", symbol: "A", weightBps: 0 }]);
    expect(rows).toEqual([{ token: "0xa", amount: "" }]);
  });
});
