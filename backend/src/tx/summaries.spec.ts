import { describe, expect, it } from "vitest";
import { formatTokenAmount, approveSummary, mintSummary } from "./summaries.js";

describe("tx summaries", () => {
  it("formats a token amount with symbol", () => {
    expect(formatTokenAmount(100000000000000000n, 18, "TSLA")).toBe("0.1 TSLA");
    expect(formatTokenAmount(2500000000000000000n, 18, "AMZN")).toBe("2.5 AMZN");
    expect(formatTokenAmount(3000000000000000000n, 18, "X")).toBe("3 X");
  });
  it("builds approve + mint summaries", () => {
    expect(approveSummary(100000000000000000n, 18, "TSLA", "vault")).toMatch(/Approve vault to pull 0.1 TSLA/);
    expect(mintSummary(3000000000000000000n, "mDEMO")).toMatch(/Mint 3 mDEMO/);
  });
});
