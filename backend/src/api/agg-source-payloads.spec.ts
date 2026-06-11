import { describe, it, expect, vi } from "vitest";
import { AggSourcePayloads } from "./agg-source-payloads.js";

const W = "0xaaaa" as `0x${string}`;
const WE = "0xbbbb" as `0x${string}`;

function makeSvc(signerPayloads: [`0x${string}`, `0x${string}`] = [W, WE]) {
  const signer = { payloadsFor: vi.fn(async () => signerPayloads) };
  return { svc: new AggSourcePayloads(signer as never), signer };
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
    const svc = new AggSourcePayloads(signer as never);
    await expect(svc.payloadsFor(["0xabc" as `0x${string}`])).rejects.toThrow("no price");
  });
});
