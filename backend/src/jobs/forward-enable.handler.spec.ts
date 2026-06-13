import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnableParams } from "../api/forward-enable.params.js";
import { ForwardEnableHandler } from "./forward-enable.handler.js";

const PARAMS: EnableParams = {
  minPrints: 5,
  twapWindowSec: 300,
  twapBandBps: 50,
  pegBandBps: 50,
  pegMaxAgeSec: 600,
  cutoffDelaySec: 3600,
  spreadBps: 10,
  capacityBps: 5000,
  keeperTip: "1000000000000000000",
  keeperBps: 25,
};

const CAP_MAP: Record<string, string> = {
  FairValueNAV: "0xNAV",
  BasketNavObserver: "0xOBS",
  KeeperModule: "0xKEEPER",
  PriceAggregator: "0xAGG",
  UniversalSignedSource: "0xWEEKDAY",
  UniversalSignedSourceWeekend: "0xWEEKEND",
  USDG: "0xUSDG",
  ForwardCashQueue: "0xREF",
};

interface Cfg {
  status: string;
  params: EnableParams;
  queueAddress: string | null;
}

function makeHandler(opts: {
  vaultType: string;
  cfg: Cfg | null;
  deployRejects?: boolean;
  registryHeld?: string[];
}) {
  const setStatusCalls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const repo = {
    getForwardQueueConfig: vi.fn(async () => opts.cfg),
    setForwardQueueStatus: vi.fn(async (vault: string, status: string, data?: Record<string, unknown>) => {
      setStatusCalls.push([vault, status, data]);
    }),
  };

  const writer = {
    deployQueue: vi.fn(async (_args: { stable: string }) => {
      if (opts.deployRejects) throw new Error("boom");
      return "0xQUEUE";
    }),
    setGateParams: vi.fn(async () => "0xG1"),
    setG1Refs: vi.fn(async () => "0xG2"),
    setKeeperTip: vi.fn(async () => "0xG3"),
    setSpreadBps: vi.fn(async () => "0xG4"),
    setCapacity: vi.fn(async () => "0xG5"),
    setCutoffDelay: vi.fn(async () => "0xG6"),
    ensureExecutor: vi.fn(async () => "0xEXEC"),
    ensureSettler: vi.fn(async () => "0xSETTLE"),
    ensureSources: vi.fn(async () => "0xSRC"),
    setKeeperBps: vi.fn(async () => "0xKBPS"),
  };

  const registry = { address: vi.fn((c: string) => CAP_MAP[c]) };
  const managedReader = { heldTokens: vi.fn(async () => ["0xT1", "0xT2"]) };
  const forwardQueues = { refresh: vi.fn(async () => {}) };

  const chain = {
    publicClient: {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case "router":
            return "0xROUTER";
          case "pegFeed":
            return "0xPEG";
          case "heldTokens":
            return opts.registryHeld ?? ["0xR1", "0xR2"];
          case "feeToken":
            return "0xFEE";
          default:
            return undefined;
        }
      }),
    },
    account: { address: "0xOWNER" },
  };

  const prisma = {
    basket: { findUnique: vi.fn(async () => ({ vaultType: opts.vaultType })) },
  };

  const handler = new ForwardEnableHandler(
    repo as never,
    writer as never,
    registry as never,
    managedReader as never,
    forwardQueues as never,
    chain as never,
    prisma as never,
  );

  return { handler, repo, writer, registry, managedReader, forwardQueues, chain, prisma, setStatusCalls };
}

function finalStatus(calls: Array<[string, string, Record<string, unknown> | undefined]>) {
  return calls[calls.length - 1];
}

describe("ForwardEnableHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns early when there is no config row", async () => {
    const { handler, repo, writer } = makeHandler({ vaultType: "Rebalance", cfg: null });
    await handler.run("0xVAULT");
    expect(repo.setForwardQueueStatus).not.toHaveBeenCalled();
    expect(writer.deployQueue).not.toHaveBeenCalled();
  });

  it("managed happy path: deploys with USDG stable, no settler, ends Live, refreshes", async () => {
    const { handler, writer, forwardQueues, setStatusCalls } = makeHandler({
      vaultType: "Rebalance",
      cfg: { status: "Pending", params: PARAMS, queueAddress: null },
    });
    await handler.run("0xVAULT");

    expect(writer.deployQueue).toHaveBeenCalledTimes(1);
    const deployArgs = writer.deployQueue.mock.calls[0]![0] as { stable: string };
    expect(deployArgs.stable).toBe("0xUSDG");
    expect(writer.ensureSettler).not.toHaveBeenCalled();
    expect(writer.ensureSources).toHaveBeenCalledTimes(2);
    expect(forwardQueues.refresh).toHaveBeenCalledWith(true);

    const [vault, status, data] = finalStatus(setStatusCalls)!;
    expect(vault).toBe("0xVAULT");
    expect(status).toBe("Live");
    expect(data!.queueAddress).toBe("0xQUEUE");
  });

  it("sets keeperBps when > 0", async () => {
    const { handler, writer } = makeHandler({
      vaultType: "Rebalance",
      cfg: { status: "Pending", params: PARAMS, queueAddress: null },
    });
    await handler.run("0xVAULT");
    expect(writer.setKeeperBps).toHaveBeenCalledWith("0xVAULT", 25);
  });

  it("does NOT set keeperBps when 0", async () => {
    const { handler, writer } = makeHandler({
      vaultType: "Rebalance",
      cfg: { status: "Pending", params: { ...PARAMS, keeperBps: 0 }, queueAddress: null },
    });
    await handler.run("0xVAULT");
    expect(writer.setKeeperBps).not.toHaveBeenCalled();
  });

  it("registry path: calls ensureSettler and deploys with feeToken as stable", async () => {
    const { handler, writer } = makeHandler({
      vaultType: "Registry",
      cfg: { status: "Pending", params: PARAMS, queueAddress: null },
    });
    await handler.run("0xVAULT");

    expect(writer.ensureSettler).toHaveBeenCalledTimes(1);
    const deployArgs = writer.deployQueue.mock.calls[0]![0] as { stable: string };
    expect(deployArgs.stable).toBe("0xFEE");
  });

  it("failure path: marks Failed with an error and does not throw", async () => {
    const { handler, setStatusCalls } = makeHandler({
      vaultType: "Rebalance",
      cfg: { status: "Pending", params: PARAMS, queueAddress: null },
      deployRejects: true,
    });
    await expect(handler.run("0xVAULT")).resolves.toBeUndefined();
    const [, status, data] = finalStatus(setStatusCalls)!;
    expect(status).toBe("Failed");
    expect(data!.error).toBeTruthy();
  });

  it("idempotent resume: existing queueAddress skips deploy, still configures + ends Live", async () => {
    const { handler, writer, setStatusCalls } = makeHandler({
      vaultType: "Rebalance",
      cfg: { status: "Failed", params: PARAMS, queueAddress: "0xEXISTING" },
    });
    await handler.run("0xVAULT");

    expect(writer.deployQueue).not.toHaveBeenCalled();
    expect(writer.setGateParams).toHaveBeenCalled();
    expect(writer.ensureExecutor).toHaveBeenCalled();
    const [, status, data] = finalStatus(setStatusCalls)!;
    expect(status).toBe("Live");
    expect(data!.queueAddress).toBe("0xEXISTING");
  });
});
