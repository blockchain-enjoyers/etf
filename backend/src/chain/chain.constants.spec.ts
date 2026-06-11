import { describe, expect, it } from "vitest";
import { defineRhcChain } from "./chain.constants.js";

describe("defineRhcChain", () => {
  it("builds a viem chain for the given id + rpc with multicall3 wired", () => {
    const chain = defineRhcChain({
      chainId: 46630,
      rpcUrl: "https://rpc.example",
      multicall3Address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    });
    expect(chain.id).toBe(46630);
    expect(chain.rpcUrls.default.http[0]).toBe("https://rpc.example");
    expect(chain.contracts?.multicall3?.address).toBe(
      "0xcA11bde05977b3631167028862bE2a173976CA11",
    );
  });

  it("defaults the rpc to a placeholder when none is given (dev/test)", () => {
    const chain = defineRhcChain({
      chainId: 46630,
      multicall3Address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    });
    expect(chain.rpcUrls.default.http[0]).toContain("http");
  });
});
