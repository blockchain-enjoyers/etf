import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviewRail, buildDeployRequest } from "./PreviewRail";
import { ApiContext } from "../../lib/api";
import type { WizardState } from "./types";
import { initialState } from "./reducer";
import type { Gate } from "../../capabilities/use-capabilities";
import type { DeployPreview, MeridianApi } from "@meridian/sdk";

const SALT = ("0x" + "0".repeat(64)) as `0x${string}`;

/** A non-gated preview with a resolved unitQty — required for the deploy button to enable. */
function readyPreview(): DeployPreview {
  return {
    unitQty: ["1000000000000000000"],
    breakdown: [],
    totalValueUsd: "0",
    priceMissing: [],
    predictedVault: "0xVault",
    gate: { gated: false, reason: "none" },
  };
}

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({ address: undefined, isConnected: false })),
}));

vi.mock("../../capabilities/use-capabilities", () => ({
  useCapabilities: vi.fn(),
}));

const mockRun = vi.fn();
vi.mock("../../wallet/use-tx-plan", () => ({
  useTxPlan: () => ({ run: mockRun, status: "idle", currentStep: 0, total: 0, error: null, steps: [] }),
}));

import * as capsModule from "../../capabilities/use-capabilities";

const mockUseCapabilities = vi.mocked(capsModule.useCapabilities);

const api = { buildDeployTx: vi.fn() } as unknown as MeridianApi;

function renderRail(state: WizardState, preview: DeployPreview | undefined = readyPreview()) {
  return render(
    <ApiContext.Provider value={api}>
      <PreviewRail state={state} preview={preview} userSalt={SALT} />
    </ApiContext.Provider>,
  );
}

function readyState(): WizardState {
  return {
    ...initialState(),
    name: "Tech 5",
    symbol: "TECH5",
    constituents: [{ id: "a", token: "0x000000000000000000000000000000000000aaa1", amount: "1" }],
  };
}

function mockCaps(deployEnabled: boolean, reason: Gate["reason"] = "ok") {
  mockUseCapabilities.mockReturnValue({
    status: () => "absent",
    canMint: () => ({ enabled: false, reason: "not-deployed" as const }),
    canRedeemInKind: () => ({ enabled: true, reason: "ok" as const }),
    canRedeemCash: () => ({ enabled: false, reason: "not-deployed" as const }),
    canDeploy: () => ({ enabled: deployEnabled, reason }),
    canCurate: () => ({ enabled: false, reason: "not-deployed" as const }),
    canForwardCreate: () => ({ enabled: false, reason: "not-deployed" as const }),
    canForwardRedeem: () => ({ enabled: false, reason: "not-deployed" as const }),
    canForwardCancel: () => ({ enabled: false, reason: "not-deployed" as const }),
    canForwardKeeper: () => ({ enabled: false, reason: "not-deployed" as const }),
  });
}

beforeEach(() => {
  mockRun.mockReset();
  (api.buildDeployTx as ReturnType<typeof vi.fn>).mockReset();
  mockCaps(true);
});

describe("PreviewRail — deploy gate", () => {
  it("deploy button is disabled when canDeploy.enabled=false (not-deployed)", () => {
    mockCaps(false, "not-deployed");
    renderRail(readyState());
    expect(screen.getByRole("button", { name: /review.*deploy/i })).toBeDisabled();
  });

  it("renders the GateBanner decode when not deployed", () => {
    mockCaps(false, "not-deployed");
    renderRail(readyState());
    expect(screen.getByText(/vault isn't deployed yet/i)).toBeInTheDocument();
  });

  it("deploy button is disabled when wallet is disconnected", () => {
    mockCaps(false, "wallet-disconnected");
    renderRail(readyState());
    expect(screen.getByRole("button", { name: /review.*deploy/i })).toBeDisabled();
  });

  it("deploy button is disabled when checks fail even if canDeploy=true", () => {
    mockCaps(true);
    const badState: WizardState = { ...readyState(), name: "" };
    renderRail(badState);
    expect(screen.getByRole("button", { name: /review.*deploy/i })).toBeDisabled();
  });

  it("deploy button is enabled when canDeploy=true and all checks pass", () => {
    mockCaps(true);
    renderRail(readyState());
    expect(screen.getByRole("button", { name: /review.*deploy/i })).not.toBeDisabled();
  });

  it("clicking deploy runs the tx-plan against buildDeployTx with the mapped request", async () => {
    mockCaps(true);
    const user = userEvent.setup();
    renderRail(readyState());
    await user.click(screen.getByRole("button", { name: /review.*deploy/i }));

    expect(mockRun).toHaveBeenCalledOnce();
    const [fetcher] = mockRun.mock.calls[0]!;
    fetcher();
    expect(api.buildDeployTx).toHaveBeenCalledOnce();
    const req = (api.buildDeployTx as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(req).toMatchObject({ vaultKind: "basket", name: "Tech 5", symbol: "TECH5" });
    // unitQty is relayed from the preview (not recomputed from the amount column).
    expect(req.unitQty).toEqual(["1000000000000000000"]);
    expect(req.userSalt).toBe(SALT);
  });

  it("deploy stays disabled until a non-gated preview with unitQty arrives", () => {
    mockCaps(true);
    renderRail(readyState(), { ...readyPreview(), gate: { gated: true, reason: "price-missing" } });
    expect(screen.getByRole("button", { name: /review.*deploy/i })).toBeDisabled();
  });

  it("disables deploy when the weights preview is gated (price-missing)", () => {
    mockCaps(true);
    const s: WizardState = { ...readyState(), vaultKind: "rebalance" };
    // a preview with a missing price gates deploy regardless of canDeploy
    renderRail(s, {
      unitQty: [],
      breakdown: [],
      totalValueUsd: "0",
      priceMissing: ["0x…"],
      predictedVault: null,
      gate: { gated: true, reason: "price-missing" },
    });
    expect(screen.getByRole("button", { name: /review.*deploy/i })).toBeDisabled();
    // the gate reason surfaces near the deploy button
    expect(screen.getByLabelText(/preview gate reason/i)).toHaveTextContent("price-missing");
  });

  // IRON RULE: canRedeemInKind must never return market-closed
  it("iron rule: canRedeemInKind reason is never market-closed", () => {
    mockCaps(true);
    const result = capsModule.useCapabilities("regular");
    const gate = result.canRedeemInKind();
    expect(gate.reason).not.toBe("market-closed");
  });
});

function makeState(overrides: Partial<WizardState>): WizardState {
  return { ...initialState(), ...overrides };
}

describe("buildDeployRequest", () => {
  it("emits rebalance request incl. keeper fields, manager defaults to wallet, base-unit strings", () => {
    const account = ("0x" + "a".repeat(40)) as `0x${string}`;
    const req = buildDeployRequest(
      makeState({
        vaultKind: "rebalance",
        manager: "", managerFeeBps: "50", keeperBps: "1000", keeperEscrow: "",
        creationUnitSize: "1000",
        constituents: [{ id: "1", token: "0x" + "1".repeat(40), amount: "2" }],
      }),
      account,
      ["2000000000000000000"],
      SALT,
    );
    expect(req.vaultKind).toBe("rebalance");
    expect(req.keeperBps).toBe(1000);
    expect(req.managerFeeBps).toBe(50);
    expect(req.manager).toBe("0x" + "a".repeat(40));
    expect(req.account).toBe(account.toLowerCase());
    // base-unit strings (18-dec), not bigints.
    expect(req.unitSize).toBe("1000000000000000000000");
    // unitQty is relayed verbatim from the preview argument.
    expect(req.unitQty).toEqual(["2000000000000000000"]);
    expect(req.tokens).toEqual(["0x" + "1".repeat(40)]);
    expect(req.userSalt).toBe(SALT);
  });

  it("omits manager/keeper fields for a static basket", () => {
    const req = buildDeployRequest(
      makeState({
        vaultKind: "basket",
        constituents: [{ id: "1", token: "0x" + "1".repeat(40), amount: "1" }],
      }),
      ("0x" + "b".repeat(40)) as `0x${string}`,
      ["1000000000000000000"],
      SALT,
    );
    expect(req.vaultKind).toBe("basket");
    expect(req.manager).toBeUndefined();
    expect(req.keeperBps).toBeUndefined();
    expect(req.managerFeeBps).toBeUndefined();
  });
});

describe("PreviewRail — fee rows by vault kind", () => {
  function rebalanceReady(): WizardState {
    return {
      ...readyState(),
      vaultKind: "rebalance",
      // weights mode: Σ must equal 100 for the deploy gate (constituentsOk) to pass.
      constituents: [{ id: "a", token: "0x000000000000000000000000000000000000aaa1", amount: "100" }],
      manager: "0x" + "a".repeat(40),
      managerFeeBps: "50",
      keeperBps: "1000",
    };
  }

  it("static basket shows neither manager-fee nor keeper-cut rows", () => {
    renderRail(readyState());
    expect(screen.queryByText(/manager fee/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/keeper cut/i)).not.toBeInTheDocument();
  });

  it("managed shows manager-fee but NOT keeper-cut", () => {
    renderRail({ ...readyState(), vaultKind: "managed", managerFeeBps: "100" });
    expect(screen.getByText(/manager fee/i)).toBeInTheDocument();
    expect(screen.queryByText(/keeper cut/i)).not.toBeInTheDocument();
  });

  it("rebalance shows both manager-fee and keeper-cut", () => {
    renderRail(rebalanceReady());
    expect(screen.getByText(/manager fee/i)).toBeInTheDocument();
    expect(screen.getByText(/keeper cut/i)).toBeInTheDocument();
  });

  it("rebalance with empty manager enables deploy (defaults to wallet, parity with Step5)", () => {
    renderRail({ ...rebalanceReady(), manager: "" });
    expect(screen.getByRole("button", { name: /review.*deploy/i })).not.toBeDisabled();
  });

  it("rebalance with a non-empty invalid manager disables deploy", () => {
    renderRail({ ...rebalanceReady(), manager: "0xnothex" });
    expect(screen.getByRole("button", { name: /review.*deploy/i })).toBeDisabled();
  });
});

describe("PreviewRail — mode-aware validation rows", () => {
  it("weights mode (rebalance) shows the Weights sum KV", () => {
    renderRail({ ...readyState(), vaultKind: "rebalance", manager: "0x" + "a".repeat(40), managerFeeBps: "50", keeperBps: "1000" });
    expect(screen.getByText(/weights sum/i)).toBeInTheDocument();
  });

  it("quantities mode (basket) does not show the Weights sum KV", () => {
    renderRail(readyState());
    expect(screen.queryByText(/weights sum/i)).not.toBeInTheDocument();
  });

  it("disables deploy when rebalance weights sum ≠ 100 even with a non-gated preview", () => {
    mockCaps(true);
    const s: WizardState = {
      ...readyState(),
      vaultKind: "rebalance",
      manager: "0x" + "a".repeat(40),
      managerFeeBps: "50",
      keeperBps: "1000",
      valuePerUnitUsd: "1000",
      constituents: [
        { id: "a", token: "0x" + "1".repeat(40), amount: "40" },
        { id: "b", token: "0x" + "2".repeat(40), amount: "50" },
      ],
    };
    renderRail(s);
    expect(screen.getByRole("button", { name: /review.*deploy/i })).toBeDisabled();
  });
});
