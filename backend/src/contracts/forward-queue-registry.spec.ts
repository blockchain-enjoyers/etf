import { describe, it, expect } from "vitest";
import { ForwardQueueRegistry } from "./forward-queue-registry.js";

function withMap(json: string) {
  const config = { get: (k: string) => (k === "FORWARD_QUEUES" ? json : undefined) };
  return new ForwardQueueRegistry(config as never);
}

describe("ForwardQueueRegistry", () => {
  it("resolves queueFor (case-insensitive) and lists pairs", () => {
    const reg = withMap('{"0xVault":"0xQueue"}');
    expect(reg.queueFor("0xvault")).toBe("0xQueue");
    expect(reg.queueFor("0xVAULT")).toBe("0xQueue");
    expect(reg.queueFor("0xother")).toBeUndefined();
    expect(reg.pairs()).toEqual([{ vault: "0xvault", queue: "0xQueue" }]);
  });

  it("empty/malformed map => no pairs, never throws", () => {
    expect(withMap("").pairs()).toEqual([]);
    expect(withMap("not json").pairs()).toEqual([]);
    expect(withMap("").queueFor("0xv")).toBeUndefined();
  });
});
