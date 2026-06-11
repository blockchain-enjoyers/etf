import { describe, it, expect, vi } from "vitest";
import { OnChainNavReader } from "./onchain-nav.reader.js";
import { OracleSeverity } from "../domain/oracle.js";
import { MarketStatus } from "../domain/market-status.js";

const TOKEN = "0x000000000000000000000000000000000000000A" as const;

function makeNavResult(overrides: Partial<{
  nav: bigint; confLower: bigint; confUpper: bigint; marketStatus: number; safe: boolean; timestamp: bigint;
}> = {}) {
  return {
    nav: 2000n * 10n ** 18n,
    confLower: 0n,
    confUpper: 0n,
    marketStatus: 0,
    safe: true,
    timestamp: 1n,
    ...overrides,
  };
}

function reader(opts: {
  simulateContract?: ReturnType<typeof vi.fn>;
  readContract?: ReturnType<typeof vi.fn>;
  registryAddr?: (key: string) => string | undefined;
  signerPayloads?: [`0x${string}`, `0x${string}`];
}) {
  const defaultAddr = (key: string) => {
    if (key === "FairValueNAV") return "0xfairvalue";
    if (key === "PriceAggregator") return "0xaggregator";
    return undefined;
  };
  const chain = {
    publicClient: {
      simulateContract: opts.simulateContract ?? vi.fn(),
      readContract: opts.readContract ?? vi.fn(),
    },
  } as never;
  const registry = { address: opts.registryAddr ?? defaultAddr } as never;
  const payloads: [`0x${string}`, `0x${string}`] = opts.signerPayloads ?? ["0xweekday", "0xweekend"];
  const signer = { payloadsFor: vi.fn().mockResolvedValue(payloads) } as never;
  return new OnChainNavReader(chain, registry, signer);
}

describe("OnChainNavReader.readL4Holdings", () => {
  it("Open market (L4 status=0, safe=true) → estimated=false, Regular", async () => {
    const simulateContract = vi.fn().mockResolvedValue({ result: makeNavResult({ marketStatus: 0, safe: true }) });
    const readContract = vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "heldTokens") return Promise.resolve([TOKEN]);
      if (functionName === "totalSupply") return Promise.resolve(2n * 10n ** 18n);
      return Promise.reject(new Error(`unexpected: ${functionName}`));
    });

    const r = await reader({ simulateContract, readContract }).readL4Holdings("0xreb");

    // perShare = nav*1e18/supply = (2000e18 * 1e18) / 2e18 = 1000e18
    expect(r.nav).toBe(1000n * 10n ** 18n);
    expect(r.estimated).toBe(false);
    expect(r.marketStatus).toBe(MarketStatus.Regular);
    expect(r.safe).toBe(true);
    expect(r.severity).toBe(OracleSeverity.Open);
  });

  it("Closed market (L4 status=3, safe=false) → estimated=true, Closed (IRON RULE)", async () => {
    const simulateContract = vi.fn().mockResolvedValue({ result: makeNavResult({ marketStatus: 3, safe: false }) });
    const readContract = vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "heldTokens") return Promise.resolve([TOKEN]);
      if (functionName === "totalSupply") return Promise.resolve(2n * 10n ** 18n);
      return Promise.reject(new Error(`unexpected: ${functionName}`));
    });

    const r = await reader({ simulateContract, readContract }).readL4Holdings("0xreb");

    expect(r.estimated).toBe(true); // closed market → never a settlement price
    expect(r.safe).toBe(false);
    expect(r.marketStatus).toBe(MarketStatus.Closed);
    expect(r.severity).toBe(OracleSeverity.Closed);
  });

  it("passes signer payloads to simulateContract for each held token", async () => {
    const signerPayloads: [`0x${string}`, `0x${string}`] = ["0xwkday", "0xwkend"];
    const simulateContract = vi.fn().mockResolvedValue({ result: makeNavResult() });
    const readContract = vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "heldTokens") return Promise.resolve([TOKEN]);
      if (functionName === "totalSupply") return Promise.resolve(1n * 10n ** 18n);
      return Promise.reject(new Error(`unexpected: ${functionName}`));
    });

    await reader({ simulateContract, readContract, signerPayloads }).readL4Holdings("0xreb");

    const callArgs = simulateContract.mock.calls[0];
    expect(callArgs).toBeDefined();
    const call = callArgs![0] as { functionName: string; args: unknown[] };
    expect(call.functionName).toBe("navOfHoldings");
    expect(call.args[2]).toEqual([signerPayloads]); // payloads[][]: one entry per token
  });
});
