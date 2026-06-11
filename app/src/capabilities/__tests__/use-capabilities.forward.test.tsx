import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCapabilities } from "../use-capabilities";

const mockAccount = vi.fn();
const mockChainId = vi.fn();

vi.mock("wagmi", () => ({
  useAccount: () => mockAccount(),
  useChainId: () => mockChainId(),
}));

vi.mock("@meridian/contracts", () => ({
  addresses: { 46630: { CloneFactory: "0xfactory" } },
}));

vi.mock("../../data/useAvailability", () => ({ useAvailability: () => ({ data: undefined }) }));

beforeEach(() => {
  mockAccount.mockReturnValue({ isConnected: true, address: "0xme" });
  mockChainId.mockReturnValue(46630);
});

describe("useCapabilities — forward gates", () => {
  it("canForwardCreate enabled when connected, on chain, bootstrapped", () => {
    const { result } = renderHook(() => useCapabilities("regular"));
    expect(result.current.canForwardCreate("0xv", true)).toEqual({ enabled: true, reason: "ok" });
  });

  it("canForwardCreate disabled (not-bootstrapped) when not bootstrapped", () => {
    const { result } = renderHook(() => useCapabilities("regular"));
    expect(result.current.canForwardCreate("0xv", false).enabled).toBe(false);
  });

  it("canForwardCreate disabled when wallet disconnected", () => {
    mockAccount.mockReturnValue({ isConnected: false, address: undefined });
    const { result } = renderHook(() => useCapabilities("regular"));
    expect(result.current.canForwardCreate("0xv", true).reason).toBe("wallet-disconnected");
  });

  it("canForwardRedeem / canForwardCancel enabled when connected", () => {
    const { result } = renderHook(() => useCapabilities("regular"));
    expect(result.current.canForwardRedeem().enabled).toBe(true);
    expect(result.current.canForwardCancel().enabled).toBe(true);
  });

  it("canForwardKeeper enabled only for the manager", () => {
    const { result } = renderHook(() => useCapabilities("regular"));
    expect(result.current.canForwardKeeper("0xme").enabled).toBe(true);
    expect(result.current.canForwardKeeper("0xother").reason).toBe("manager-mismatch");
  });
});
