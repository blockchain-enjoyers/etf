import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MarketStatus } from "@meridian/sdk";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(),
}));

vi.mock("@meridian/contracts", () => ({
  addresses: {
    421614: {},
    46630: {},
  },
  CHAIN_IDS: { robinhoodChainTestnet: 46630, arbitrumSepolia: 421614 },
}));

vi.mock("../data/useAvailability", () => ({ useAvailability: vi.fn(() => ({ data: undefined })) }));

import { useAccount, useChainId } from "wagmi";
import { addresses } from "@meridian/contracts";
import { useAvailability } from "../data/useAvailability";
import { useCapabilities } from "./use-capabilities";

const mockUseAccount = vi.mocked(useAccount);
const mockUseChainId = vi.mocked(useChainId);
const mockUseAvailability = vi.mocked(useAvailability);

function renderCapabilities(marketStatus: MarketStatus) {
  return renderHook(() => useCapabilities(marketStatus)).result.current;
}

describe("useCapabilities — dormant (empty addresses)", () => {
  beforeEach(() => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0xabc" as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(421614);
  });

  it("status returns absent when address map is empty", () => {
    const caps = renderCapabilities("regular");
    expect(caps.status("BasketVault")).toBe("absent");
    expect(caps.status("CloneFactory")).toBe("absent");
  });

  it("canMint is disabled with not-deployed when CloneFactory absent", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xvault");
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("not-deployed");
  });

  it("canDeploy is disabled with not-deployed when CloneFactory absent", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canDeploy();
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("not-deployed");
  });
});

describe("useCapabilities — wallet disconnected", () => {
  beforeEach(() => {
    mockUseAccount.mockReturnValue({
      isConnected: false,
      address: undefined,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(421614);
  });

  it("canRedeemInKind is disabled with wallet-disconnected when not connected", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canRedeemInKind();
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("wallet-disconnected");
  });

  it("canRedeemCash is disabled with wallet-disconnected when not connected", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canRedeemCash();
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("wallet-disconnected");
  });
});

describe("useCapabilities — live addresses (stubbed)", () => {
  beforeEach(() => {
    (addresses as Record<number, Record<string, string>>)[421614] = {
      BasketVault: "0xVaultAddr",
      CloneFactory: "0xFactoryAddr",
    };
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0xuser" as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(421614);
  });

  afterEach(() => {
    (addresses as Record<number, Record<string, string>>)[421614] = {};
  });

  it("status returns live when address is present", () => {
    const caps = renderCapabilities("regular");
    expect(caps.status("BasketVault")).toBe("live");
    expect(caps.status("CloneFactory")).toBe("live");
  });

  it("canMint returns ok when vault present + connected + correct chain", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xVaultAddr");
    expect(gate.enabled).toBe(true);
    expect(gate.reason).toBe("ok");
  });

  it("canDeploy returns ok when factory present + connected", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canDeploy();
    expect(gate.enabled).toBe(true);
    expect(gate.reason).toBe("ok");
  });

  it("canRedeemInKind returns ok regardless of marketStatus", () => {
    for (const ms of ["regular", "closed", "overnight", "postMarket", "preMarket", "unknown"] as MarketStatus[]) {
      const caps = renderCapabilities(ms);
      const gate = caps.canRedeemInKind();
      expect(gate.enabled).toBe(true);
      expect(gate.reason).toBe("ok");
    }
  });

  it("canRedeemCash returns market-closed when marketStatus is not regular", () => {
    for (const ms of ["closed", "overnight", "postMarket", "preMarket", "unknown"] as MarketStatus[]) {
      const caps = renderCapabilities(ms);
      const gate = caps.canRedeemCash();
      expect(gate.enabled).toBe(false);
      expect(gate.reason).toBe("market-closed");
    }
  });

  it("canRedeemCash returns ok when marketStatus is regular", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canRedeemCash();
    expect(gate.enabled).toBe(true);
    expect(gate.reason).toBe("ok");
  });
});

describe("useCapabilities — wrong-chain vs not-deployed", () => {
  afterEach(() => {
    (addresses as Record<number, Record<string, string>>)[421614] = {};
  });

  it("canMint returns wrong-chain for an unsupported chainId (e.g. 1)", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0xabc" as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(1);
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xvault");
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("wrong-chain");
  });

  it("canDeploy returns wrong-chain for an unsupported chainId (e.g. 1)", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0xabc" as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(1);
    const caps = renderCapabilities("regular");
    const gate = caps.canDeploy();
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("wrong-chain");
  });

  it("canMint returns not-deployed for a supported chain with empty addresses (46630)", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0xabc" as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(46630);
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xvault");
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("not-deployed");
  });

  it("canDeploy returns not-deployed for a supported chain with empty addresses (421614)", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0xabc" as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(421614);
    const caps = renderCapabilities("regular");
    const gate = caps.canDeploy();
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("not-deployed");
  });
});

// ─── frozen gate ──────────────────────────────────────────────────────────────
describe("canMint — frozen basket", () => {
  beforeEach(() => {
    (addresses as Record<number, Record<string, string>>)[421614] = {
      BasketVault: "0xVaultAddr",
      CloneFactory: "0xFactoryAddr",
    };
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0xuser" as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(421614);
  });

  afterEach(() => {
    (addresses as Record<number, Record<string, string>>)[421614] = {};
  });

  it("canMint returns frozen when frozen=true", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xVaultAddr", true);
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("frozen");
  });

  it("canMint returns ok when frozen=false", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xVaultAddr", false);
    expect(gate.enabled).toBe(true);
    expect(gate.reason).toBe("ok");
  });

  it("canMint returns ok when frozen is omitted", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xVaultAddr");
    expect(gate.enabled).toBe(true);
    expect(gate.reason).toBe("ok");
  });

  it("IRON RULE: canRedeemInKind is still enabled when basket is frozen", () => {
    const caps = renderCapabilities("regular");
    const gate = caps.canRedeemInKind();
    expect(gate.enabled).toBe(true);
    expect(gate.reason).toBe("ok");
  });
});

// ─── canCurate ────────────────────────────────────────────────────────────────
describe("canCurate — manager address check", () => {
  const MANAGER = "0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef";

  beforeEach(() => {
    (addresses as Record<number, Record<string, string>>)[46630] = {
      CloneFactory: "0xFactoryAddr",
    };
  });

  afterEach(() => {
    (addresses as Record<number, Record<string, string>>)[46630] = {};
  });

  it("canCurate enabled only when connected address === manager", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: MANAGER as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(46630);

    const caps = renderCapabilities("regular");
    expect(caps.canCurate(MANAGER).enabled).toBe(true);
    expect(caps.canCurate(MANAGER.toLowerCase()).enabled).toBe(true);
    expect(caps.canCurate("0xother").enabled).toBe(false);
  });

  it("canCurate returns manager-mismatch when address differs", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: MANAGER as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(46630);

    const caps = renderCapabilities("regular");
    expect(caps.canCurate("0xother").reason).toBe("manager-mismatch");
  });

  it("canCurate returns wallet-disconnected when not connected", () => {
    mockUseAccount.mockReturnValue({
      isConnected: false,
      address: undefined,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(46630);

    const caps = renderCapabilities("regular");
    expect(caps.canCurate(MANAGER).enabled).toBe(false);
    expect(caps.canCurate(MANAGER).reason).toBe("wallet-disconnected");
  });

  it("canCurate returns wrong-chain for unsupported chainId", () => {
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: MANAGER as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(1);

    const caps = renderCapabilities("regular");
    expect(caps.canCurate(MANAGER).enabled).toBe(false);
    expect(caps.canCurate(MANAGER).reason).toBe("wrong-chain");
  });

  it("canCurate returns not-deployed when CloneFactory absent", () => {
    (addresses as Record<number, Record<string, string>>)[46630] = {};
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: MANAGER as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(46630);

    const caps = renderCapabilities("regular");
    expect(caps.canCurate(MANAGER).enabled).toBe(false);
    expect(caps.canCurate(MANAGER).reason).toBe("not-deployed");
  });
});

// ─── IRON RULE ────────────────────────────────────────────────────────────────
describe("IRON RULE: canRedeemInKind is NEVER market-closed", () => {
  beforeEach(() => {
    (addresses as Record<number, Record<string, string>>)[421614] = {
      BasketVault: "0xVaultAddr",
    };
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0xuser" as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(421614);
  });

  afterEach(() => {
    (addresses as Record<number, Record<string, string>>)[421614] = {};
  });

  it.each(["unknown", "preMarket", "regular", "postMarket", "overnight", "closed"] as MarketStatus[])(
    "canRedeemInKind reason is never market-closed when status=%s",
    (ms) => {
      const caps = renderCapabilities(ms);
      const gate = caps.canRedeemInKind();
      expect(gate.reason).not.toBe("market-closed");
    }
  );
});

// ─── backend availability AND-gate ──────────────────────────────────────────────
describe("useCapabilities — backend availability verdict", () => {
  beforeEach(() => {
    (addresses as Record<number, Record<string, string>>)[421614] = {
      BasketVault: "0xVaultAddr",
      CloneFactory: "0xFactoryAddr",
    };
    mockUseAccount.mockReturnValue({
      isConnected: true,
      address: "0xuser" as `0x${string}`,
    } as ReturnType<typeof useAccount>);
    mockUseChainId.mockReturnValue(421614);
  });

  afterEach(() => {
    (addresses as Record<number, Record<string, string>>)[421614] = {};
    mockUseAvailability.mockReturnValue({ data: undefined } as ReturnType<typeof useAvailability>);
  });

  it("canMint reflects a disabling backend verdict when local checks pass", () => {
    mockUseAvailability.mockReturnValue({
      data: { items: [{ action: "mint", enabled: false, reason: "frozen" }] },
    } as ReturnType<typeof useAvailability>);
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xVaultAddr");
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("frozen");
  });

  it("canMint stays ok when the backend reports mint enabled", () => {
    mockUseAvailability.mockReturnValue({
      data: { items: [{ action: "mint", enabled: true, reason: "ok" }] },
    } as ReturnType<typeof useAvailability>);
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xVaultAddr");
    expect(gate.enabled).toBe(true);
    expect(gate.reason).toBe("ok");
  });

  it("maps backend 'unsupported-vault-type' to a disabled not-deployed gate (non-rebalance vault)", () => {
    mockUseAvailability.mockReturnValue({
      data: { items: [{ action: "forwardCreate", enabled: false, reason: "unsupported-vault-type" }] },
    } as ReturnType<typeof useAvailability>);
    const caps = renderCapabilities("regular");
    const gate = caps.canForwardCreate("0xVaultAddr", true);
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("not-deployed");
  });

  it("canForwardCreate returns not-bootstrapped (not not-deployed) for a deployed-but-unseeded vault", () => {
    mockUseAvailability.mockReturnValue({ data: { items: [] } } as unknown as ReturnType<typeof useAvailability>);
    const caps = renderCapabilities("regular");
    const gate = caps.canForwardCreate("0xVaultAddr", false);
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("not-bootstrapped");
  });

  it("an unknown backend reason can't crash the gate (falls back to ok)", () => {
    // Model a forward-compat payload whose reason the FE enum doesn't know — double-cast through
    // unknown since the literal is intentionally out-of-contract (no `any`).
    mockUseAvailability.mockReturnValue({
      data: { items: [{ action: "mint", enabled: false, reason: "totally-unknown-reason" }] },
    } as unknown as ReturnType<typeof useAvailability>);
    const caps = renderCapabilities("regular");
    const gate = caps.canMint("0xVaultAddr");
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("ok");
  });
});
