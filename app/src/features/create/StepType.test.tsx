import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StepType } from "./StepType";
import { initialState } from "./reducer";
import { ApiContext } from "../../lib/api";
import type { MeridianApi } from "@meridian/sdk";

// StepType mounts HowToChooseModal, which reads the suggested-funds catalog via the SDK.
const api = { getSuggestedFunds: vi.fn(async () => ({ funds: [] })) } as unknown as MeridianApi;

function renderStep(props: Partial<React.ComponentProps<typeof StepType>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>
        <StepType state={initialState()} dispatch={vi.fn()} onBack={vi.fn()} onNext={vi.fn()} {...props} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

describe("StepType", () => {
  it("dispatches SET_VAULT_KIND when a card is chosen", async () => {
    const dispatch = vi.fn();
    const user = userEvent.setup();
    renderStep({ dispatch });
    await user.click(screen.getByRole("radio", { name: /rebalanced/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_VAULT_KIND", value: "rebalance" });
  });

  it("has a How do I choose button (modal arrives in P6)", () => {
    renderStep();
    expect(screen.getByRole("button", { name: /how do i choose/i })).toBeInTheDocument();
  });

  it("Next is always enabled (a kind is always selected)", () => {
    renderStep();
    expect(screen.getByRole("button", { name: /next/i })).not.toBeDisabled();
  });
});
