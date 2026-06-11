import { describe, expect, it, vi } from "vitest";
import { TwapRecordHandler } from "./twap-record.handler.js";

const OBSERVER = "0x0000000000000000000000000000000000000011";
const NAV_OBSERVER = "0x0000000000000000000000000000000000000022";
const TOKEN_A = "0x000000000000000000000000000000000000000a";
const TOKEN_B = "0x000000000000000000000000000000000000000b";
const VAULT = "0x00000000000000000000000000000000000000e1";

const PAYLOAD_WD = "0xaa01" as `0x${string}`;
const PAYLOAD_WE = "0xaa02" as `0x${string}`;
const PAYLOADS: readonly [`0x${string}`, `0x${string}`] = [PAYLOAD_WD, PAYLOAD_WE];

interface WriteCall {
  address: string;
  functionName: string;
  args: unknown[];
}

function make(
  over: Partial<{
    enabled: boolean;
    wallet: boolean;
    observer?: string;
    navObserver?: string;
    tokens: { token: string }[];
    baskets: { vaultAddress: string }[];
    held: `0x${string}`[];
  }> = {},
) {
  const config = { get: vi.fn((k: string) => (k === "ORACLE_PUSH_ENABLED" ? (over.enabled ?? true) : undefined)) };
  const registry = {
    address: vi.fn((c: string) =>
      c === "RebalanceObserver"
        ? ("observer" in over ? over.observer : OBSERVER)
        : c === "BasketNavObserver"
          ? ("navObserver" in over ? over.navObserver : undefined)
          : undefined,
    ),
  };
  const prisma = {
    constituent: { findMany: vi.fn().mockResolvedValue(over.tokens ?? [{ token: TOKEN_A }]) },
    basket: { findMany: vi.fn().mockResolvedValue(over.baskets ?? []) },
  };
  const writeContract = vi.fn().mockResolvedValue("0xhash");
  const wallet = (over.wallet ?? true) ? { writeContract } : undefined;
  const chain = {
    chain: {},
    account: (over.wallet ?? true) ? { address: "0xkeeper" } : undefined,
    walletClient: wallet,
    publicClient: { waitForTransactionReceipt: vi.fn().mockResolvedValue({}) },
  };
  const signer = { payloadsFor: vi.fn(async (_token: string) => PAYLOADS) };
  const rebVault = { heldTokens: vi.fn(async () => over.held ?? [TOKEN_A, TOKEN_B]) };
  return {
    h: new TwapRecordHandler(
      prisma as never,
      chain as never,
      registry as never,
      config as never,
      signer as never,
      rebVault as never,
    ),
    writeContract,
    prisma,
    signer,
    rebVault,
  };
}

describe("TwapRecordHandler", () => {
  it("no-ops when disabled or keeper wallet missing", async () => {
    const off = make({ enabled: false });
    await off.h.run();
    expect(off.writeContract).not.toHaveBeenCalled();
    expect(off.prisma.constituent.findMany).not.toHaveBeenCalled();

    const noWallet = make({ wallet: false });
    await noWallet.h.run();
    expect(noWallet.prisma.constituent.findMany).not.toHaveBeenCalled();
  });

  it("records each distinct constituent on RebalanceObserver with the signer's payloads", async () => {
    const { h, writeContract, signer } = make({ tokens: [{ token: TOKEN_A }, { token: TOKEN_B }] });
    await h.run();
    expect(signer.payloadsFor).toHaveBeenCalledWith(TOKEN_A);
    expect(signer.payloadsFor).toHaveBeenCalledWith(TOKEN_B);
    expect(writeContract).toHaveBeenCalledTimes(2);
    const first = writeContract.mock.calls[0]![0] as WriteCall;
    expect(first.address).toBe(OBSERVER);
    expect(first.functionName).toBe("record");
    expect(first.args).toEqual([TOKEN_A, PAYLOADS]);
    const second = writeContract.mock.calls[1]![0] as WriteCall;
    expect(second.args).toEqual([TOKEN_B, PAYLOADS]);
  });

  it("skips part 1 with no error when RebalanceObserver is absent", async () => {
    const { h, writeContract } = make({ observer: undefined });
    await expect(h.run()).resolves.toBeUndefined();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("skips part 2 silently when BasketNavObserver is absent (pre-L5 world)", async () => {
    const { h, prisma, writeContract } = make({ navObserver: undefined });
    await expect(h.run()).resolves.toBeUndefined();
    expect(prisma.basket.findMany).not.toHaveBeenCalled();
    expect(writeContract).toHaveBeenCalledTimes(1); // part 1 only
  });

  it("records rebalance-vault NAV on BasketNavObserver with held tokens + payload matrix", async () => {
    const { h, writeContract, rebVault } = make({
      navObserver: NAV_OBSERVER,
      baskets: [{ vaultAddress: VAULT }],
      held: [TOKEN_A, TOKEN_B],
    });
    await h.run();
    expect(rebVault.heldTokens).toHaveBeenCalledWith(VAULT);
    const navCall = writeContract.mock.calls.at(-1)![0] as WriteCall;
    expect(navCall.address).toBe(NAV_OBSERVER);
    expect(navCall.functionName).toBe("record");
    expect(navCall.args).toEqual([VAULT, [TOKEN_A, TOKEN_B], [PAYLOADS, PAYLOADS]]);
  });

  it("isolates per-token failures", async () => {
    const { h, writeContract, signer } = make({ tokens: [{ token: TOKEN_B }, { token: TOKEN_A }] });
    signer.payloadsFor
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(PAYLOADS);
    await h.run();
    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0]![0] as WriteCall;
    expect(call.args[0]).toBe(TOKEN_A);
  });

  it("isolates per-vault failures", async () => {
    const { h, writeContract, rebVault } = make({
      navObserver: NAV_OBSERVER,
      tokens: [],
      baskets: [{ vaultAddress: VAULT }, { vaultAddress: "0x00000000000000000000000000000000000000e2" }],
    });
    rebVault.heldTokens.mockRejectedValueOnce(new Error("boom"));
    await h.run();
    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0]![0] as WriteCall;
    expect(call.args[0]).toBe("0x00000000000000000000000000000000000000e2");
  });
});
