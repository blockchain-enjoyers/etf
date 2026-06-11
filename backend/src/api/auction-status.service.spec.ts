import { describe, expect, it, vi } from "vitest";
import { AuctionStatusService } from "./auction-status.service.js";

const VAULT = "0xvault";
const AUCTION_ADDR = "0xauction";
const ACCOUNT = "0xaccount";

function makeRegistry(addr: string | undefined) {
  return { address: vi.fn().mockReturnValue(addr) };
}

function makeChain(execMode: number, acquireIn: bigint[], openAllow: boolean) {
  return {
    publicClient: {
      readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
        if (functionName === "execMode") return Promise.resolve(execMode);
        if (functionName === "currentAcquireIn") return Promise.resolve(acquireIn);
        if (functionName === "openAllow") return Promise.resolve(openAllow);
        return Promise.reject(new Error(`unexpected: ${functionName}`));
      }),
    },
  };
}

describe("AuctionStatusService", () => {
  it("returns not-deployed defaults when RebalanceAuction is absent", async () => {
    const svc = new AuctionStatusService(
      makeChain(0, [], false) as never,
      makeRegistry(undefined) as never,
    );
    const result = await svc.status(VAULT, null);
    expect(result).toEqual({
      vaultAddress: VAULT,
      deployed: false,
      execMode: 0,
      openAllow: false,
      acquireIn: [],
    });
  });

  it("returns deployed status with correct shapes (Number execMode, string acquireIn)", async () => {
    const chain = makeChain(2, [1000000000000000000n], true);
    const registry = makeRegistry(AUCTION_ADDR);
    const svc = new AuctionStatusService(chain as never, registry as never);

    const result = await svc.status(VAULT, ACCOUNT);

    expect(result.deployed).toBe(true);
    expect(result.execMode).toBe(2);
    expect(typeof result.execMode).toBe("number");
    expect(result.acquireIn).toEqual(["1000000000000000000"]);
    expect(result.openAllow).toBe(true);
  });

  it("openAllow is false when account is null even if deployed", async () => {
    const chain = makeChain(1, [], true);
    const svc = new AuctionStatusService(chain as never, makeRegistry(AUCTION_ADDR) as never);

    const result = await svc.status(VAULT, null);

    expect(result.openAllow).toBe(false);
    const calls = (chain.publicClient.readContract as ReturnType<typeof vi.fn>).mock.calls;
    const fnNames = calls.map((c) => (c[0] as { functionName: string }).functionName);
    expect(fnNames).not.toContain("openAllow");
  });

  it("recovers to safe defaults when readContract reverts", async () => {
    const chain = {
      publicClient: {
        readContract: vi.fn().mockRejectedValue(new Error("revert")),
      },
    };
    const svc = new AuctionStatusService(chain as never, makeRegistry(AUCTION_ADDR) as never);

    const result = await svc.status(VAULT, ACCOUNT);

    expect(result.deployed).toBe(true);
    expect(result.execMode).toBe(0);
    expect(result.acquireIn).toEqual([]);
    expect(result.openAllow).toBe(false);
  });
});
