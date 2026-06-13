import { describe, it, expect, vi } from "vitest";
import { AggSourcePayloads } from "./agg-source-payloads.js";

const W = "0xaaaa" as `0x${string}`;
const WE = "0xbbbb" as `0x${string}`;
const noScene = { isSceneToken: () => false };

function makeSvc(signerPayloads: [`0x${string}`, `0x${string}`] = [W, WE]) {
  const signer = { payloadsFor: vi.fn(async () => signerPayloads) };
  return { svc: new AggSourcePayloads(signer as never, noScene as never), signer };
}

describe("AggSourcePayloads", () => {
  it("delegates each token to PayloadSignerService and returns [weekday, weekend] per token", async () => {
    const { svc, signer } = makeSvc();
    const tokens = [
      "0x000000000000000000000000000000000000000a" as `0x${string}`,
      "0x000000000000000000000000000000000000000b" as `0x${string}`,
    ];
    const result = await svc.payloadsFor(tokens);
    expect(signer.payloadsFor).toHaveBeenCalledTimes(2);
    expect(signer.payloadsFor).toHaveBeenCalledWith(tokens[0]);
    expect(signer.payloadsFor).toHaveBeenCalledWith(tokens[1]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([W, WE]);
    expect(result[1]).toEqual([W, WE]);
  });

  it("returns empty array for empty token list", async () => {
    const { svc } = makeSvc();
    const result = await svc.payloadsFor([]);
    expect(result).toEqual([]);
  });

  it("propagates signer errors", async () => {
    const signer = { payloadsFor: vi.fn(async () => { throw new Error("no price"); }) };
    const svc = new AggSourcePayloads(signer as never, noScene as never);
    await expect(svc.payloadsFor(["0xabc" as `0x${string}`])).rejects.toThrow("no price");
  });
});

describe("AggSourcePayloads scene-aware", () => {
  const signer = { payloadsFor: vi.fn(async () => ["0xWD", "0xWE"]) };
  const scene = (toks: string[]) => ({ isSceneToken: (t: string) => toks.includes(t.toLowerCase()) });
  it("scene token -> [weekday, weekend, 0x]", async () => {
    const a = new AggSourcePayloads(signer as never, scene(["0xs"]) as never);
    expect(await a.payloadsFor(["0xS" as `0x${string}`])).toEqual([["0xWD", "0xWE", "0x"]]);
  });
  it("non-scene token -> [weekday, weekend]", async () => {
    const a = new AggSourcePayloads(signer as never, scene([]) as never);
    expect(await a.payloadsFor(["0xR" as `0x${string}`])).toEqual([["0xWD", "0xWE"]]);
  });
});
