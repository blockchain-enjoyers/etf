import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailabilityResponse } from "@meridian/sdk";
import { TxPlanBuilder } from "./tx-plan.builder.js";

// Valid-shaped hex addresses for the fixtures.
const VAULT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const ACCOUNT = "0x3333333333333333333333333333333333333333";
const FACTORY = "0x4444444444444444444444444444444444444444";

function dec(s: string) {
  return { toFixed: (_n: number) => s, toString: () => s };
}

const basketRow = {
  vaultAddress: VAULT,
  symbol: "mTECH",
  unitSize: dec("1000"),
  vaultType: "Basket" as const,
  constituents: [{ token: TOKEN, unitQty: dec("10") }],
};

interface Mocks {
  availabilityEnabled: boolean;
  availabilityReason: AvailabilityResponse["items"][number]["reason"];
  simulateResult: boolean;
  allowance: bigint; // erc20 allowance the approval probe reads
  cloneFactory: string | undefined;
}

function makeBuilder(over: Partial<Mocks> = {}) {
  const m: Mocks = {
    availabilityEnabled: true,
    availabilityReason: "ok",
    simulateResult: true,
    allowance: 0n, // < required → an approve step is produced
    cloneFactory: FACTORY,
    ...over,
  };

  const availability = {
    availability: vi.fn(async (vault: string, account: string | null): Promise<AvailabilityResponse> => ({
      vaultAddress: vault,
      account,
      items: [
        { action: "mint", enabled: m.availabilityEnabled, reason: m.availabilityReason },
        { action: "redeemInKind", enabled: true, reason: "ok" },
      ],
    })),
  };

  const simulator = { simulate: vi.fn(async () => m.simulateResult) };

  const prisma = {
    basket: { findUnique: vi.fn(async () => basketRow) },
    priceSnapshot: { findFirst: vi.fn(async () => ({ price: dec("0") })) },
    navSnapshot: { findFirst: vi.fn(async () => null) },
  };

  const publicClient = {
    // approvals.ts probes allowance via multicall (allowFailure); return below the required amount.
    multicall: vi.fn(async () => [{ status: "success", result: m.allowance }]),
    // mint.ts supportsPermit probes nonces() per constituent; reject → fall back to approve path.
    readContract: vi.fn(async () => {
      throw new Error("no permit");
    }),
  };

  const chain = { publicClient };
  const registry = { address: vi.fn(() => m.cloneFactory) };
  const tokenMeta = {
    getMany: vi.fn(async () => ({ [TOKEN.toLowerCase()]: { symbol: "AAA", decimals: 18, token: TOKEN, name: "AAA" } })),
  };
  const config = { get: vi.fn(() => 46630) };
  const rebVault = { heldTokens: vi.fn(async () => [TOKEN]) };

  const signer = { payloadsFor: vi.fn(async () => ["0xaa", "0xbb"] as const) };
  // Per-vault forward-queue registry (read path's ForwardQueueRegistry); the forward + keeper builders
  // resolve the vault's bound queue through this instead of the chain singleton.
  const forwardQueues = { queueFor: vi.fn((_v: string) => undefined as string | undefined) };
  // Reads queue.observer() so keeper record targets the vault's own observer (not a chain singleton).
  const queueReader = { observer: vi.fn(async (_q: string) => undefined as unknown as `0x${string}`) };

  const builder = new TxPlanBuilder(
    chain as never,
    registry as never,
    prisma as never,
    tokenMeta as never,
    simulator as never,
    availability as never,
    config as never,
    rebVault as never,
    signer as never,
    forwardQueues as never,
    queueReader as never,
  );

  return { builder, availability, simulator, registry, prisma };
}

describe("TxPlanBuilder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gates mint when availability is disabled → empty steps + gated plan", async () => {
    const { builder } = makeBuilder({ availabilityEnabled: false, availabilityReason: "frozen" });
    const plan = await builder.mint(VAULT, { units: "1", account: ACCOUNT });
    expect(plan.gate).toEqual({ gated: true, reason: "frozen" });
    expect(plan.steps).toEqual([]);
    expect(plan.finalize).toBeNull();
    expect(plan.chainId).toBe(46630);
  });

  it("maps a disabled non-frozen reason to the coarse 'halted' backstop", async () => {
    const { builder } = makeBuilder({ availabilityEnabled: false, availabilityReason: "market-closed" });
    const plan = await builder.mint(VAULT, { units: "1", account: ACCOUNT });
    expect(plan.gate).toEqual({ gated: true, reason: "halted" });
  });

  it("mint (approve path): standalone approve simulates true, dependent call → simulated:false", async () => {
    const { builder, simulator } = makeBuilder({ simulateResult: true });
    const plan = await builder.mint(VAULT, { units: "1", account: ACCOUNT });

    expect(plan.gate).toEqual({ gated: false, reason: "none" });
    const approve = plan.steps.find((s) => s.kind === "approve");
    const call = plan.steps.find((s) => s.kind === "call");
    expect(approve).toBeDefined();
    expect(call).toBeDefined();
    // Standalone approve has no prior dependency → it is simulated (mock returns true).
    expect((approve as { simulated: boolean }).simulated).toBe(true);
    // The create call needsPriorApproval → not simulatable pre-approval → simulated:false.
    expect((call as { simulated: boolean }).simulated).toBe(false);
    // Only the approve step was actually sent to the simulator.
    expect(simulator.simulate).toHaveBeenCalledTimes(1);
  });

  it("redeem returns the action's call step, gate ungated, and still consults availability", async () => {
    const { builder, availability, simulator } = makeBuilder();
    const plan = await builder.redeem(VAULT, { amount: "5", account: ACCOUNT });

    expect(plan.gate.gated).toBe(false);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.kind).toBe("call");
    expect((plan.steps[0] as { simulated: boolean }).simulated).toBe(true); // redeem has no prior approval
    expect(availability.availability).toHaveBeenCalledOnce();
    expect(simulator.simulate).toHaveBeenCalledOnce();
  });

  it("deploy returns the CloneFactory call with gate ungated", async () => {
    const { builder } = makeBuilder();
    const plan = await builder.deploy({
      account: ACCOUNT,
      vaultKind: "basket",
      name: "Tech",
      symbol: "mTECH",
      tokens: [TOKEN],
      unitQty: ["10"],
      unitSize: "1000",
    });

    expect(plan.gate.gated).toBe(false);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.kind).toBe("call");
    expect((plan.steps[0] as { contractName: string }).contractName).toBe("CloneFactory");
    expect((plan.steps[0] as { simulated: boolean }).simulated).toBe(true);
  });

  it("deploy gates to 'halted' when CloneFactory is not registered", async () => {
    const { builder } = makeBuilder({ cloneFactory: undefined });
    const plan = await builder.deploy({
      account: ACCOUNT,
      vaultKind: "basket",
      name: "Tech",
      symbol: "mTECH",
      tokens: [TOKEN],
      unitQty: ["10"],
      unitSize: "1000",
    });
    expect(plan.gate).toEqual({ gated: true, reason: "halted" });
    expect(plan.steps).toEqual([]);
  });
});
