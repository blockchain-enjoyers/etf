import { describe, it, expect, vi } from "vitest";
import { SceneOracleService, DemoDisabledError } from "./scene-oracle.service.js";
const cfg = (en: boolean) => ({ enabled: en, isSceneToken: () => true, mockFor: () => "0xMOCK", tokens: () => ["0xt"] });
const chain = () => ({
  chain: { id: 46630 },
  account: { address: "0xk" },
  walletClient: { writeContract: vi.fn(async () => "0xh") },
  publicClient: { readContract: vi.fn(async () => ({ price: 100n })) },
});
describe("SceneOracleService", () => {
  it("404s (DemoDisabledError) when disabled", async () => {
    const s = new SceneOracleService(cfg(false) as never, chain() as never);
    await expect(s.tamper("0xt", "1")).rejects.toBeInstanceOf(DemoDisabledError);
  });
  it("404s for a non-scene token", async () => {
    const c = { ...cfg(true), mockFor: () => undefined };
    const s = new SceneOracleService(c as never, chain() as never);
    await expect(s.tamper("0xt", "1")).rejects.toBeInstanceOf(DemoDisabledError);
  });
  it("sets the mock via the keeper walletClient", async () => {
    const c = chain();
    const s = new SceneOracleService(cfg(true) as never, c as never);
    const r = await s.tamper("0xt", (5n * 10n ** 18n).toString());
    expect(r.txHash).toBe("0xh");
    const call = (c.walletClient.writeContract.mock.calls[0] as unknown[])[0] as { address: string; functionName: string; args: unknown[] };
    expect(call.address).toBe("0xMOCK");
    expect(call.functionName).toBe("set");
    expect(call.args[0]).toBe(5n * 10n ** 18n); // price
    expect(call.args[6]).toBe(true);            // healthy
  });
  it("read() returns the mock price", async () => {
    const s = new SceneOracleService(cfg(true) as never, chain() as never);
    expect(await s.read("0xt")).toEqual({ token: "0xt", mockPrice: "100" });
  });
});
