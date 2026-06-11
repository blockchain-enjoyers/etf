import { describe, it, expect, vi } from "vitest";
import { ForwardApProvider } from "./forward-ap.provider.js";

function provider(opts: { enabled?: boolean; wallet?: boolean; ap?: string }) {
  const config = {
    get: (k: string) => {
      if (k === "FORWARD_OPERATOR_ENABLED") return opts.enabled ?? true;
      if (k === "FORWARD_AP_FILLER_ADDRESS") return "ap" in opts ? opts.ap : "0xap";
      return undefined;
    },
  };
  const chain = { walletClient: opts.wallet === false ? undefined : { account: { address: "0xop" } } };
  const writer = { approve: vi.fn(async () => "0xtx" as const) };
  return { p: new ForwardApProvider(config as never, chain as never, writer as never), writer };
}

describe("ForwardApProvider.prepare", () => {
  it("noop when disabled", async () => {
    const { p, writer } = provider({ enabled: false });
    expect((await p.prepare("0xv", [1n])).status).toBe("noop");
    expect(writer.approve).not.toHaveBeenCalled();
  });

  it("noop when no walletClient", async () => {
    const { p } = provider({ wallet: false });
    expect((await p.prepare("0xv", [1n])).status).toBe("noop");
  });

  it("noop when no AP filler configured", async () => {
    const { p } = provider({ ap: undefined });
    expect((await p.prepare("0xv", [1n])).status).toBe("noop");
  });

  it("skips when no ids", async () => {
    const { p } = provider({});
    expect((await p.prepare("0xv", [])).status).toBe("skipped");
  });

  it("approves the filler for the batch when enabled", async () => {
    const { p, writer } = provider({});
    const res = await p.prepare("0xv", [1n, 2n]);
    expect(res.status).toBe("submitted");
    expect(writer.approve).toHaveBeenCalledWith("0xv", "0xap");
  });
});
