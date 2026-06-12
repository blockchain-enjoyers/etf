import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData } from "viem";
import { RebalanceAuctionAbi } from "@meridian/contracts";
import { buildAuctionBid, buildAuctionOpen, buildAuctionSetExecMode } from "./auction.js";

const VAULT = "0x000000000000000000000000000000000000aa01";
const AUCTION = "0x00000000000000000000000000000000000000c0" as `0x${string}`;
const ACCOUNT = "0x0000000000000000000000000000000000000a00";

// Valid 40-hex addresses for the legs.
const REL_TOKEN = "0x00000000000000000000000000000000000000a1";
const ACQ_TOKEN = "0x00000000000000000000000000000000000000b2";
const ACQ_TOKEN2 = "0x00000000000000000000000000000000000000b3";

type Call = { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean; contractName?: string };

function makeDeps(opts: { addr?: `0x${string}` | undefined; allowances?: bigint[] } = {}) {
  const allowances = opts.allowances ?? [0n, 0n];
  return {
    publicClient: {
      multicall: vi.fn().mockResolvedValue(allowances.map((a) => ({ status: "success", result: a }))),
    },
    meta: {
      getMany: vi.fn().mockResolvedValue({
        [ACQ_TOKEN.toLowerCase()]: { symbol: "ACQ", decimals: 18 },
        [ACQ_TOKEN2.toLowerCase()]: { symbol: "AC2", decimals: 18 },
      }),
    },
    registry: { address: vi.fn().mockReturnValue("addr" in opts ? opts.addr : AUCTION) },
  };
}

describe("buildAuctionSetExecMode", () => {
  it("encodes setExecMode(vault, mode) targeting the auction with no approvals", () => {
    const deps = makeDeps({ addr: AUCTION });

    const result = buildAuctionSetExecMode(deps, VAULT, { mode: 1 });

    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as Call;
    expect(call.kind).toBe("call");
    expect(call.to).toBe(AUCTION);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);

    const expected = encodeFunctionData({
      abi: RebalanceAuctionAbi,
      functionName: "setExecMode",
      args: [VAULT as `0x${string}`, 1],
    });
    expect(call.data).toBe(expected);
    // 0x + 4-byte selector + 2 * 32-byte words (vault, mode) = 2 + 8 + 128 = 138 chars.
    expect(call.data).toHaveLength(138);
  });

  it("encodes each settable ExecMode value distinctly", () => {
    const deps = makeDeps({ addr: AUCTION });
    for (const mode of [0, 1]) {
      const call = buildAuctionSetExecMode(deps, VAULT, { mode }).steps[0] as Call;
      expect(call.data).toBe(
        encodeFunctionData({ abi: RebalanceAuctionAbi, functionName: "setExecMode", args: [VAULT as `0x${string}`, mode] }),
      );
    }
  });

  it("rejects PERMISSIONLESS (mode 2 — contract-disabled) before building a reverting tx", () => {
    const deps = makeDeps({ addr: AUCTION });
    expect(() => buildAuctionSetExecMode(deps, VAULT, { mode: 2 })).toThrow(/invalid auction exec mode/);
  });

  it("throws not-deployed when RebalanceAuction is unregistered", () => {
    const deps = makeDeps({ addr: undefined });
    expect(() => buildAuctionSetExecMode(deps, VAULT, { mode: 0 })).toThrow(/not-deployed/);
  });
});

describe("buildAuctionOpen", () => {
  const REQ = {
    account: ACCOUNT,
    durationSec: 3600,
    release: [{ token: REL_TOKEN, releaseOut: "1000000000000000000" }],
    acquire: [{ token: ACQ_TOKEN, startIn: "2000000000000000000", endIn: "1000000000000000000" }],
  };

  it("encodes open(vault, release[], releaseOut[], acquire[], startIn[], endIn[], duration) from the legs", () => {
    const deps = makeDeps({ addr: AUCTION });

    const result = buildAuctionOpen(deps, VAULT, REQ);

    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as Call;
    expect(call.kind).toBe("call");
    expect(call.to).toBe(AUCTION);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);

    // Independently encode with the exact ABI arg order to pin selector + args.
    const expected = encodeFunctionData({
      abi: RebalanceAuctionAbi,
      functionName: "open",
      args: [
        VAULT as `0x${string}`,
        [REL_TOKEN as `0x${string}`],
        [1000000000000000000n],
        [ACQ_TOKEN as `0x${string}`],
        [2000000000000000000n],
        [1000000000000000000n],
        3600n,
      ],
    });
    expect(call.data).toBe(expected);
  });

  it("maps multiple release + acquire legs positionally", () => {
    const deps = makeDeps({ addr: AUCTION });
    const req = {
      account: ACCOUNT,
      durationSec: 7200,
      release: [
        { token: REL_TOKEN, releaseOut: "1000000000000000000" },
        { token: ACQ_TOKEN2, releaseOut: "3000000000000000000" },
      ],
      acquire: [
        { token: ACQ_TOKEN, startIn: "5000000000000000000", endIn: "4000000000000000000" },
      ],
    };

    const call = buildAuctionOpen(deps, VAULT, req).steps[0] as Call;
    const expected = encodeFunctionData({
      abi: RebalanceAuctionAbi,
      functionName: "open",
      args: [
        VAULT as `0x${string}`,
        [REL_TOKEN as `0x${string}`, ACQ_TOKEN2 as `0x${string}`],
        [1000000000000000000n, 3000000000000000000n],
        [ACQ_TOKEN as `0x${string}`],
        [5000000000000000000n],
        [4000000000000000000n],
        7200n,
      ],
    });
    expect(call.data).toBe(expected);
  });

  it("does not build approvals for open (opener releases vault tokens, not its own)", () => {
    const deps = makeDeps({ addr: AUCTION });
    buildAuctionOpen(deps, VAULT, REQ);
    expect(deps.publicClient.multicall).not.toHaveBeenCalled();
    expect(deps.meta.getMany).not.toHaveBeenCalled();
  });

  it("throws not-deployed when RebalanceAuction is unregistered", () => {
    const deps = makeDeps({ addr: undefined });
    expect(() => buildAuctionOpen(deps, VAULT, REQ)).toThrow(/not-deployed/);
  });
});

describe("buildAuctionBid", () => {
  const REQ = {
    account: ACCOUNT,
    acquire: [
      { token: ACQ_TOKEN, amount: "5000000000000000000" },
      { token: ACQ_TOKEN2, amount: "6000000000000000000" },
    ],
  };

  it("emits approve(token→auction) steps for each acquire token then bid(vault)", async () => {
    const deps = makeDeps({ addr: AUCTION, allowances: [0n, 0n] });

    const result = await buildAuctionBid(deps, VAULT, REQ);

    expect(result.steps).toHaveLength(3);

    const approves = result.steps.filter((s) => s.kind === "approve") as Call[];
    expect(approves).toHaveLength(2);
    expect(approves[0]!.to).toBe(ACQ_TOKEN);
    expect(approves[0]!.contractName).toBe("ACQ");
    expect(approves[1]!.to).toBe(ACQ_TOKEN2);

    // Approvals target the auction as spender for the entered amounts.
    expect(approves[0]!.data).toBe(
      encodeFunctionData({
        abi: (await import("viem")).erc20Abi,
        functionName: "approve",
        args: [AUCTION, 5000000000000000000n],
      }),
    );

    const call = result.steps[2] as Call;
    expect(call.kind).toBe("call");
    expect(call.to).toBe(AUCTION);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(true);

    const expected = encodeFunctionData({
      abi: RebalanceAuctionAbi,
      functionName: "bid",
      args: [VAULT as `0x${string}`],
    });
    expect(call.data).toBe(expected);
    // 0x + 4-byte selector + 1 * 32-byte word (vault) = 2 + 8 + 64 = 74 chars.
    expect(call.data).toHaveLength(74);
  });

  it("omits approve steps when allowances already cover the acquire amounts", async () => {
    const deps = makeDeps({ addr: AUCTION, allowances: [10n ** 20n, 10n ** 20n] });

    const result = await buildAuctionBid(deps, VAULT, REQ);

    expect(result.steps.filter((s) => s.kind === "approve")).toHaveLength(0);
    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as Call;
    expect(call.kind).toBe("call");
    expect(call.to).toBe(AUCTION);
    expect(call.needsPriorApproval).toBe(true);
  });

  it("emits no approvals when the acquire list is empty (bid only)", async () => {
    const deps = makeDeps({ addr: AUCTION });

    const result = await buildAuctionBid(deps, VAULT, { account: ACCOUNT, acquire: [] });

    expect(result.steps).toHaveLength(1);
    expect(deps.publicClient.multicall).not.toHaveBeenCalled();
    const call = result.steps[0] as Call;
    expect(call.kind).toBe("call");
    expect(call.to).toBe(AUCTION);
  });

  it("throws not-deployed when RebalanceAuction is unregistered", async () => {
    const deps = makeDeps({ addr: undefined });
    await expect(buildAuctionBid(deps, VAULT, REQ)).rejects.toThrow(/not-deployed/);
  });
});
