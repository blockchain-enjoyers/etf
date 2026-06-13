import { describe, it, expect, vi } from "vitest";
import { maxUint256 } from "viem";
import { ForwardEnableWriter } from "./forward-enable.writer.js";

type AnyArgs = { address?: string; functionName?: string; args?: unknown[]; account?: unknown; chain?: unknown };

function fakeChain(reads: Record<string, unknown> = {}) {
  const publicClient = {
    readContract: vi.fn(({ functionName }: { functionName: string }) =>
      Promise.resolve(reads[functionName]),
    ),
    waitForTransactionReceipt: vi.fn(
      (_a: unknown): Promise<{ contractAddress: string | null }> =>
        Promise.resolve({ contractAddress: "0xQUEUE" }),
    ),
  };
  const walletClient = {
    writeContract: vi.fn((_a: AnyArgs) => Promise.resolve("0xWRITE")),
    deployContract: vi.fn((_a: AnyArgs) => Promise.resolve("0xDEPLOY")),
  };
  const chain = {
    chain: { id: 46630 },
    publicClient,
    walletClient,
    account: { address: "0xowner" },
  };
  return { chain, publicClient, walletClient };
}

function writerWith(reads: Record<string, unknown> = {}) {
  const { chain, publicClient, walletClient } = fakeChain(reads);
  return {
    writer: new ForwardEnableWriter(chain as never),
    publicClient,
    walletClient,
  };
}

describe("ForwardEnableWriter", () => {
  it("deployQueue passes the 8 ctor args in order and returns receipt.contractAddress", async () => {
    const { writer, walletClient, publicClient } = writerWith();
    const addr = await writer.deployQueue({
      vault: "0xvault",
      stable: "0xstable",
      navEngine: "0xnav",
      observer: "0xobs",
      keeperModule: "0xkeeper",
      router: "0xrouter",
      pegFeed: "0xpeg",
      owner: "0xowner",
    });
    expect(addr).toBe("0xQUEUE");
    const call = walletClient.deployContract.mock.calls[0]![0];
    expect(call.args).toEqual([
      "0xvault",
      "0xstable",
      "0xnav",
      "0xobs",
      "0xkeeper",
      "0xrouter",
      "0xpeg",
      "0xowner",
    ]);
    expect(call.account).toEqual({ address: "0xowner" });
    expect(call.chain).toEqual({ id: 46630 });
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: "0xDEPLOY" });
  });

  it("deployQueue throws when the receipt has no contractAddress", async () => {
    const { writer, publicClient } = writerWith();
    publicClient.waitForTransactionReceipt.mockResolvedValueOnce({ contractAddress: null });
    await expect(
      writer.deployQueue({
        vault: "0xvault",
        stable: "0xstable",
        navEngine: "0xnav",
        observer: "0xobs",
        keeperModule: "0xkeeper",
        router: "0xrouter",
        pegFeed: "0xpeg",
        owner: "0xowner",
      }),
    ).rejects.toThrow(/contractAddress/);
  });

  it("throws a clear error when there is no signer", async () => {
    const chain = {
      chain: { id: 46630 },
      publicClient: { readContract: vi.fn() },
      // no walletClient / account
    };
    const writer = new ForwardEnableWriter(chain as never);
    // signer() throws synchronously from the non-async setter helpers.
    expect(() => writer.setKeeperTip("0xq", 1n)).toThrow(
      "writer requires a signer (KEEPER_PRIVATE_KEY)",
    );
  });

  it("setGateParams forwards functionName + the 5 uint256 args", async () => {
    const { writer, walletClient } = writerWith();
    await writer.setGateParams("0xq", {
      minN: 2n,
      win: 600n,
      twBps: 50,
      pegBps: 100,
      pegMaxAge: 3600,
    });
    const call = walletClient.writeContract.mock.calls[0]![0];
    expect(call.address).toBe("0xq");
    expect(call.functionName).toBe("setGateParams");
    expect(call.args).toEqual([2n, 600n, 50, 100, 3600]);
  });

  it("ensureExecutor SKIPS setExecutor when already an executor", async () => {
    const { writer, walletClient } = writerWith({
      isExecutor: true,
      maxRewardPerCall: 123n,
    });
    const hash = await writer.ensureExecutor("0xkeeper", "0xq");
    expect(hash).toBeUndefined();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("ensureExecutor CALLS setExecutor when not yet an executor", async () => {
    const { writer, walletClient } = writerWith({
      isExecutor: false,
      maxRewardPerCall: 123n,
    });
    const hash = await writer.ensureExecutor("0xkeeper", "0xq");
    const fns = walletClient.writeContract.mock.calls.map((c) => c[0].functionName);
    expect(fns).toContain("setExecutor");
    expect(walletClient.writeContract.mock.calls[0]![0].args).toEqual(["0xq", true]);
    expect(hash).toBe("0xWRITE");
  });

  it("ensureExecutor writes setMaxRewardPerCall(maxUint256) only when cap is 0n", async () => {
    const { writer, walletClient } = writerWith({
      isExecutor: true,
      maxRewardPerCall: 0n,
    });
    const hash = await writer.ensureExecutor("0xkeeper", "0xq");
    const calls = walletClient.writeContract.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.functionName)).toEqual(["setMaxRewardPerCall"]);
    expect(calls[0]!.args).toEqual([maxUint256]);
    expect(hash).toBe("0xWRITE");
  });

  it("ensureSettler skips when already a settler", async () => {
    const { writer, walletClient } = writerWith({ isSettler: true });
    const hash = await writer.ensureSettler("0xvault", "0xq");
    expect(hash).toBeUndefined();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("ensureSettler writes setSettler(queue, true) when not a settler", async () => {
    const { writer, walletClient } = writerWith({ isSettler: false });
    const hash = await writer.ensureSettler("0xvault", "0xq");
    const call = walletClient.writeContract.mock.calls[0]![0];
    expect(call.functionName).toBe("setSettler");
    expect(call.args).toEqual(["0xq", true]);
    expect(hash).toBe("0xWRITE");
  });

  it("ensureSources skips when sourceCount > 0n", async () => {
    const { writer, walletClient } = writerWith({ sourceCount: 1n });
    const hash = await writer.ensureSources("0xagg", "0xtoken", "0xwd", "0xwe");
    expect(hash).toBeUndefined();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("ensureSources adds BOTH sources when sourceCount is 0n and returns the second hash", async () => {
    const { writer, walletClient } = writerWith({ sourceCount: 0n });
    const hash = await writer.ensureSources("0xagg", "0xtoken", "0xwd", "0xwe");
    const calls = walletClient.writeContract.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ functionName: "addSource", args: ["0xtoken", "0xwd"] });
    expect(calls[1]).toMatchObject({ functionName: "addSource", args: ["0xtoken", "0xwe"] });
    expect(hash).toBe("0xWRITE");
  });

  it("setKeeperBps writes via ManagedRebalanceVault selector", async () => {
    const { writer, walletClient } = writerWith();
    const hash = await writer.setKeeperBps("0xvault", 250);
    const call = walletClient.writeContract.mock.calls[0]![0];
    expect(call.functionName).toBe("setKeeperBps");
    expect(call.args).toEqual([250]);
    expect(hash).toBe("0xWRITE");
  });
});
