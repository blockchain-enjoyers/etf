import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateWizard } from "./CreateWizard";
import { ApiContext } from "../../lib/api";
import type { MeridianApi } from "@meridian/sdk";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({ address: undefined, isConnected: false })),
}));

vi.mock("../../capabilities/use-capabilities", () => ({
  useCapabilities: vi.fn(),
}));

vi.mock("../../wallet/use-tx-plan", () => ({
  useTxPlan: () => ({ run: vi.fn(), status: "idle", currentStep: 0, total: 0, error: null, steps: [] }),
}));

import * as capsModule from "../../capabilities/use-capabilities";

const mockUseCapabilities = vi.mocked(capsModule.useCapabilities);

const api = { buildDeployTx: vi.fn(), previewDeploy: vi.fn() } as unknown as MeridianApi;

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <CreateWizard />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUseCapabilities.mockReturnValue({
    status: () => "absent",
    canMint: () => ({ enabled: false, reason: "not-deployed" as const }),
    canRedeemInKind: () => ({ enabled: true, reason: "ok" as const }),
    canRedeemCash: () => ({ enabled: false, reason: "not-deployed" as const }),
    canDeploy: () => ({ enabled: false, reason: "not-deployed" as const }),
    canCurate: () => ({ enabled: false, reason: "not-deployed" as const }),
    canForwardCreate: () => ({ enabled: false, reason: "not-deployed" as const }),
    canForwardRedeem: () => ({ enabled: false, reason: "not-deployed" as const }),
    canForwardCancel: () => ({ enabled: false, reason: "not-deployed" as const }),
    canForwardKeeper: () => ({ enabled: false, reason: "not-deployed" as const }),
  });
});

describe("CreateWizard — navigation smoke test", () => {
  it("renders Step 1 on mount and shows the 5-step terminal stepper", () => {
    renderWizard();
    expect(screen.getByLabelText(/index name/i)).toBeInTheDocument();

    const stepper = screen.getByRole("navigation", { name: /progress/i });
    for (const label of [
      "Basics",
      "Vault type",
      "Constituents",
      "Settings & fees",
      "Review & deploy",
    ]) {
      expect(within(stepper).getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  it("advances to Step 2 (Vault type) after filling Step 1 and clicking Next", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByLabelText(/index name/i), "My Fund");
    await user.type(screen.getByLabelText(/ticker symbol/i), "MF");
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByRole("button", { name: /how do i choose/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /static/i })).toBeInTheDocument();
  });

  it("reaches the constituents step (Step 3) and shows the asset rows", async () => {
    const user = userEvent.setup();
    renderWizard();

    const stepper = screen.getByRole("navigation", { name: /progress/i });
    await user.click(within(stepper).getByRole("button", { name: /Constituents/i }));

    expect(screen.getByLabelText("Asset 1 token")).toBeInTheDocument();
  });

  it("jumps to a step when its stepper button is clicked (GO_STEP)", async () => {
    const user = userEvent.setup();
    renderWizard();

    const stepper = screen.getByRole("navigation", { name: /progress/i });
    await user.click(within(stepper).getByRole("button", { name: /Settings & fees/i }));

    expect(screen.queryByLabelText(/index name/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/creation unit/i)).toBeInTheDocument();
  });

  it("can navigate back to Step 1 from Step 2", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByLabelText(/index name/i), "My Fund");
    await user.type(screen.getByLabelText(/ticker symbol/i), "MF");
    await user.click(screen.getByRole("button", { name: /next/i }));

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByLabelText(/index name/i)).toBeInTheDocument();
  });

  it("preview rail is always visible and reflects the live symbol", async () => {
    const user = userEvent.setup();
    renderWizard();
    const rail = screen.getByRole("complementary", { name: /deploy preview/i });
    expect(rail).toBeInTheDocument();

    await user.type(screen.getByLabelText(/ticker symbol/i), "RHV");
    expect(within(rail).getByText("RHV")).toBeInTheDocument();
  });

  it("deploy button in preview rail is disabled (not-deployed) on mount", () => {
    renderWizard();
    const rail = screen.getByRole("complementary", { name: /deploy preview/i });
    expect(within(rail).getByRole("button", { name: /review.*deploy/i })).toBeDisabled();
  });
});
