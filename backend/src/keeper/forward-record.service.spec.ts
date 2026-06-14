import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForwardRecordService } from "./forward-record.service.js";

const PEG = "0x00000000000000000000000000000000000000e9";

function make(opts: { enabled?: boolean; wallet?: boolean; pairs?: { vault: string; queue: string }[] }) {
  const config = { get: (k: string) => (k === "FORWARD_OPERATOR_ENABLED" ? (opts.enabled ?? true) : undefined) };
  const writeContract = vi.fn(async (_args: Record<string, unknown>) => "0xtx" as `0x${string}`);
  const readContract = vi.fn(async (_a: { functionName: string }) => PEG as `0x${string}`);
  const chain = {
    chain: {},
    account: { address: "0xkeeper" },
    walletClient: opts.wallet === false ? undefined : { writeContract },
    publicClient: { readContract },
  };
  const forwardQueues = {
    refresh: vi.fn(async () => {}),
    pairs: () => opts.pairs ?? [{ vault: "0xv1", queue: "0xq1" }],
  };
  const writer = { record: vi.fn(async () => "0xrec" as `0x${string}`) };
  return {
    service: new ForwardRecordService(config as never, chain as never, forwardQueues as never, writer as never),
    writeContract,
    readContract,
    writer,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("ForwardRecordService peg refresh", () => {
  it("pokes each vault's record AND refreshes the peg feed (setUpdatedAt)", async () => {
    const { service, writeContract, readContract, writer } = make({});
    const res = await service.run();
    expect(res.status).toBe("submitted");
    expect(writer.record).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "pegFeed" }));
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(writeContract.mock.calls[0]![0]).toMatchObject({ address: PEG, functionName: "setUpdatedAt" });
  });

  it("dedupes a shared peg feed across queues (one poke for many queues)", async () => {
    const { service, writeContract } = make({
      pairs: [
        { vault: "0xv1", queue: "0xq1" },
        { vault: "0xv2", queue: "0xq2" },
      ],
    });
    await service.run();
    expect(writeContract).toHaveBeenCalledTimes(1); // both queues share PEG → one setUpdatedAt
  });

  it("noop (no peg poke) when the operator is disabled", async () => {
    const { service, writeContract } = make({ enabled: false });
    expect((await service.run()).status).toBe("noop");
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("noop when there is no walletClient", async () => {
    const { service, writeContract } = make({ wallet: false });
    expect((await service.run()).status).toBe("noop");
    expect(writeContract).not.toHaveBeenCalled();
  });
});
