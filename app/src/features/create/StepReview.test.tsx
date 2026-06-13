import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepReview } from "./StepReview";
import { ApiContext } from "../../lib/api";
import { initialState } from "./reducer";
import type { WizardState } from "./types";
import type { MeridianApi, DeployPreview } from "@meridian/sdk";

vi.mock("wagmi", () => ({ useAccount: vi.fn(() => ({ address: "0x" + "a".repeat(40), isConnected: true })) }));
vi.mock("../../capabilities/use-capabilities", () => ({ useCapabilities: vi.fn() }));
vi.mock("../../data/useAvailability", () => ({ useAvailability: vi.fn() }));
// DeploySuccess needs router/query/api providers; stub it so these tests focus on StepReview's own CTA.
vi.mock("./DeploySuccess", () => ({ DeploySuccess: () => null }));

const deployRun = vi.fn();
const scheduleRun = vi.fn();
vi.mock("../../wallet/use-tx-plan", () => ({ useTxPlan: vi.fn() }));

import * as caps from "../../capabilities/use-capabilities";
import { useTxPlan } from "../../wallet/use-tx-plan";
import { useAvailability } from "../../data/useAvailability";

/** Mock the indexer-availability gate; default = curatorSchedule enabled (vault indexed). */
function mockAvailability(curatorScheduleEnabled: boolean | undefined) {
  const items =
    curatorScheduleEnabled === undefined
      ? undefined
      : [{ action: "curatorSchedule", enabled: curatorScheduleEnabled, reason: curatorScheduleEnabled ? "ok" : "not-deployed" }];
  vi.mocked(useAvailability).mockReturnValue({ data: items ? { items } : undefined } as ReturnType<typeof useAvailability>);
}

const SALT = ("0x" + "0".repeat(64)) as `0x${string}`;
const PREVIEW: DeployPreview = {
  unitQty: ["4000000000000000000"], breakdown: [{ token: "0x" + "1".repeat(40), symbol: "AAA", qty: "4", valueUsd: "0", weightBps: 10000 }],
  totalValueUsd: "0", priceMissing: [], predictedVault: "0x" + "f".repeat(40), gate: { gated: false, reason: "none" },
};
const api = { buildDeployTx: vi.fn(), buildCuratorScheduleTx: vi.fn() } as unknown as MeridianApi;

function mockCaps(enabled = true) {
  vi.mocked(caps.useCapabilities).mockReturnValue({
    status: () => "absent", canMint: () => ({ enabled: false, reason: "not-deployed" }),
    canRedeemInKind: () => ({ enabled: true, reason: "ok" }), canRedeemCash: () => ({ enabled: false, reason: "not-deployed" }),
    canDeploy: () => ({ enabled, reason: "ok" }), canCurate: () => ({ enabled: false, reason: "not-deployed" }),
    canForwardCreate: () => ({ enabled: false, reason: "not-deployed" }), canForwardRedeem: () => ({ enabled: false, reason: "not-deployed" }),
    canForwardCancel: () => ({ enabled: false, reason: "not-deployed" }), canForwardKeeper: () => ({ enabled: false, reason: "not-deployed" }),
  } as ReturnType<typeof caps.useCapabilities>);
}

function txMock(status: string, run: typeof deployRun) {
  return { run, status, currentStep: 0, total: 0, error: null, steps: [] } as unknown as ReturnType<typeof useTxPlan>;
}

function rebalanceState(): WizardState {
  return { ...initialState(), name: "Reb", symbol: "REB", vaultKind: "rebalance",
    constituents: [{ id: "0", token: "0x" + "1".repeat(40), amount: "100" }], valuePerUnitUsd: "1000" };
}

function renderReview(state: WizardState, preview = PREVIEW, deployStatus = "idle", scheduleStatus = "idle") {
  vi.mocked(useTxPlan).mockReturnValueOnce(txMock(deployStatus, deployRun)).mockReturnValueOnce(txMock(scheduleStatus, scheduleRun));
  return render(<ApiContext.Provider value={api}><StepReview state={state} dispatch={vi.fn()} onBack={vi.fn()} preview={preview} userSalt={SALT} /></ApiContext.Provider>);
}

beforeEach(() => { vi.clearAllMocks(); mockCaps(true); mockAvailability(true); });

describe("StepReview", () => {
  it("shows the predicted vault address", () => {
    renderReview(rebalanceState());
    expect(screen.getByText(PREVIEW.predictedVault!)).toBeInTheDocument();
  });
  it("disables deploy when the preview is gated", () => {
    renderReview(rebalanceState(), { ...PREVIEW, gate: { gated: true, reason: "price-missing" }, predictedVault: null });
    expect(screen.getByRole("button", { name: /deploy index/i })).toBeDisabled();
  });
  it("deploy runs buildDeployTx with the preview unitQty", async () => {
    const user = userEvent.setup();
    renderReview(rebalanceState());
    await user.click(screen.getByRole("button", { name: /deploy index/i }));
    expect(deployRun).toHaveBeenCalledOnce();
    const [fetcher] = deployRun.mock.calls[0]!; fetcher();
    expect(api.buildDeployTx).toHaveBeenCalledOnce();
    const req = (api.buildDeployTx as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(req.unitQty).toEqual(["4000000000000000000"]);
  });
  it("after a successful rebalance deploy, the Set-target-weights CTA appears and calls buildCuratorScheduleTx", async () => {
    const user = userEvent.setup();
    renderReview(rebalanceState(), PREVIEW, "success");
    const cta = screen.getByRole("button", { name: /set target weights/i });
    await user.click(cta);
    expect(scheduleRun).toHaveBeenCalledOnce();
    const [fetcher] = scheduleRun.mock.calls[0]!; fetcher();
    expect(api.buildCuratorScheduleTx).toHaveBeenCalledWith(PREVIEW.predictedVault, expect.objectContaining({ unitQty: PREVIEW.unitQty }));
  });
  it("CTA is disabled with indexing copy while the new vault is not yet indexed (curatorSchedule not enabled)", () => {
    mockAvailability(false);
    renderReview(rebalanceState(), PREVIEW, "success");
    const cta = screen.getByRole("button", { name: /indexing/i });
    expect(cta).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^set target weights$/i })).not.toBeInTheDocument();
  });
  it("CTA is disabled while availability is still pending (no data)", () => {
    mockAvailability(undefined);
    renderReview(rebalanceState(), PREVIEW, "success");
    expect(screen.getByRole("button", { name: /indexing/i })).toBeDisabled();
  });
  it("non-rebalance deploy shows NO CTA", () => {
    renderReview({ ...rebalanceState(), vaultKind: "basket" }, PREVIEW, "success");
    expect(screen.queryByRole("button", { name: /set target weights/i })).not.toBeInTheDocument();
  });
  it("registry deploy shows the Set-target-weights CTA (shares the curator surface)", () => {
    renderReview({ ...rebalanceState(), vaultKind: "registry" }, PREVIEW, "success");
    expect(screen.getByRole("button", { name: /set target weights/i })).toBeInTheDocument();
  });
  it("mentions the timelock in the CTA copy", () => {
    renderReview(rebalanceState(), PREVIEW, "success");
    expect(screen.getByText(/timelock/i)).toBeInTheDocument();
  });
});
