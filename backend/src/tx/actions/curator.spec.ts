import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { ManagedRebalanceVaultAbi } from "@meridian/contracts";
import { buildCuratorActivate, buildCuratorSchedule } from "./curator.js";

const VAULT = "0x000000000000000000000000000000000000aa01";
const TOKEN_A = "0x000000000000000000000000000000000000aaaa" as `0x${string}`;
const TOKEN_B = "0x000000000000000000000000000000000000bbbb" as `0x${string}`;

describe("buildCuratorSchedule", () => {
  it("emits one call targeting the vault with scheduleTarget(tokens, unitQty.map(BigInt))", () => {
    const tokens = [TOKEN_A, TOKEN_B];
    const unitQty = ["1000000000000000000", "2000000000000000000"];

    const result = buildCuratorSchedule(VAULT, { tokens, unitQty });

    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(VAULT);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);

    // Pin selector: independent encode with (tokens[], unitQty[] as bigint) must match.
    const expected = encodeFunctionData({
      abi: ManagedRebalanceVaultAbi,
      functionName: "scheduleTarget",
      args: [tokens, [1000000000000000000n, 2000000000000000000n]],
    });
    expect(call.data).toBe(expected);
  });

  it("returns no approve steps", () => {
    const result = buildCuratorSchedule(VAULT, { tokens: [TOKEN_A], unitQty: ["1"] });
    expect(result.steps.filter((s) => s.kind === "approve")).toHaveLength(0);
  });
});

describe("buildCuratorActivate", () => {
  it("emits one call targeting the vault with activateTarget()", () => {
    const result = buildCuratorActivate(VAULT);

    expect(result.steps).toHaveLength(1);
    const call = result.steps[0] as { kind: string; to: string; data: string; value: string; needsPriorApproval?: boolean };
    expect(call.kind).toBe("call");
    expect(call.to).toBe(VAULT);
    expect(call.value).toBe("0");
    expect(call.needsPriorApproval).toBe(false);

    const expected = encodeFunctionData({ abi: ManagedRebalanceVaultAbi, functionName: "activateTarget" });
    expect(call.data).toBe(expected);
  });
});
