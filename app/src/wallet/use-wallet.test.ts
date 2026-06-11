import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("wagmi", () => ({
  useAccount: vi.fn(() => ({
    address: "0xabc" as `0x${string}`,
    isConnected: true,
    status: "connected",
  })),
  useConnect: vi.fn(() => ({ connect: vi.fn(), connectors: [] })),
  useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
}));

import { useWallet } from "./use-wallet";

describe("useWallet", () => {
  it("returns address and isConnected from wagmi useAccount", () => {
    const { result } = renderHook(() => useWallet());
    expect(result.current.address).toBe("0xabc");
    expect(result.current.isConnected).toBe(true);
    expect(result.current.status).toBe("connected");
  });

  it("exposes connect and disconnect functions", () => {
    const { result } = renderHook(() => useWallet());
    expect(typeof result.current.connect).toBe("function");
    expect(typeof result.current.disconnect).toBe("function");
  });
});
