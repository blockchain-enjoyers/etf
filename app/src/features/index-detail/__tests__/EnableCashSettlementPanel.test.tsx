import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../../lib/api";
import type { ForwardEnableStatus, MeridianApi } from "@meridian/sdk";

const MANAGER = "0xManager".toLowerCase();

// Module-level mutables so each test can vary the connected wallet + status payload.
let mockAddress: string | undefined = MANAGER;
const mockSign = vi.fn().mockResolvedValue("0xsig");

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: mockAddress }),
  useSignTypedData: () => ({ signTypedDataAsync: mockSign }),
}));

import { EnableCashSettlementPanel } from "../EnableCashSettlementPanel";

let statusPayload: ForwardEnableStatus;
const enableCashSettlement = vi.fn().mockResolvedValue({ status: "pending" });
const getForwardEnableStatus = vi.fn(() => Promise.resolve(statusPayload));

const api = {
  enableCashSettlement,
  getForwardEnableStatus,
} as unknown as MeridianApi;

function renderPanel(manager = MANAGER) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <EnableCashSettlementPanel vault="0xVault" manager={manager} />
      </ApiContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockAddress = MANAGER;
  statusPayload = { status: "none" };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("EnableCashSettlementPanel", () => {
  it("renders nothing when the wallet is not the manager", () => {
    mockAddress = "0xsomeoneelse";
    const { container } = renderPanel();
    expect(container.firstChild).toBeNull();
  });

  it("renders the form and submits a signed enable request with defaults", async () => {
    const user = userEvent.setup();
    renderPanel();

    const submit = await screen.findByRole("button", { name: /enable/i });
    await user.click(submit);

    await waitFor(() => expect(mockSign).toHaveBeenCalled());
    await waitFor(() => expect(enableCashSettlement).toHaveBeenCalled());

    const [vaultArg, body] = enableCashSettlement.mock.calls[0]!;
    expect(vaultArg).toBe("0xVault");
    expect(body.params.minPrints).toBe(2);
    expect(body.signature).toBe("0xsig");
  });

  it("shows the live success state with the queue address", async () => {
    statusPayload = { status: "live", queueAddress: "0xQUEUE" };
    renderPanel();

    expect(await screen.findByText(/enabled/i)).toBeInTheDocument();
    expect(screen.getByText(/0xQUEUE/i)).toBeInTheDocument();
  });
});
