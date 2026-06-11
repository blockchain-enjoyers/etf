import { describe, expect, it, vi } from "vitest";
import { buildApprovalSteps } from "./approvals.js";

const ACCOUNT  = "0x0000000000000000000000000000000000000001";
const SPENDER  = "0x00000000000000000000000000000000000000ff";
const TOKEN_A  = "0x000000000000000000000000000000000000000a";
const TOKEN_B  = "0x000000000000000000000000000000000000000b";

function deps(allowances: bigint[]) {
  return {
    publicClient: { multicall: vi.fn().mockResolvedValue(allowances.map((a) => ({ status: "success", result: a }))) },
    meta: {
      getMany: vi.fn().mockResolvedValue({
        "0x000000000000000000000000000000000000000a": { symbol: "A", decimals: 18 },
        "0x000000000000000000000000000000000000000b": { symbol: "B", decimals: 18 },
      }),
    },
  };
}

describe("buildApprovalSteps", () => {
  it("emits approve only for under-allowed tokens", async () => {
    const steps = await buildApprovalSteps(deps([0n, 1000n]), ACCOUNT, SPENDER, [
      { token: TOKEN_A, amount: 100n }, { token: TOKEN_B, amount: 100n },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.to).toBe(TOKEN_A);
    expect(steps[0]!.kind).toBe("approve");
    expect(steps[0]!.contractName).toBe("A");
  });

  it("returns [] when all sufficiently allowed or needs empty", async () => {
    expect(await buildApprovalSteps(deps([1000n, 1000n]), ACCOUNT, SPENDER, [{ token: TOKEN_A, amount: 100n }, { token: TOKEN_B, amount: 100n }])).toHaveLength(0);
    expect(await buildApprovalSteps(deps([]), ACCOUNT, SPENDER, [])).toHaveLength(0);
  });
});
