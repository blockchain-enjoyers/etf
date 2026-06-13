import { describe, it, expect, vi } from "vitest";
import { ForwardQueueRegistry } from "./forward-queue-registry.js";
const cfg = (q: string) => ({ get: () => q }) as never;
const repo = (live: { vault: string; queue: string }[]) => ({ getLiveForwardQueues: vi.fn(async () => live) }) as never;
describe("ForwardQueueRegistry env∪DB", () => {
  it("seeds from env synchronously", () => {
    const r = new ForwardQueueRegistry(cfg('{"0xAAA":"0xq1"}'), repo([]));
    expect(r.queueFor("0xaaa")).toBe("0xq1");
  });
  it("refresh() merges DB Live rows (DB wins)", async () => {
    const r = new ForwardQueueRegistry(cfg('{"0xAAA":"0xq1"}'), repo([{ vault: "0xBBB", queue: "0xq2" }]));
    await r.refresh(true);
    expect(r.queueFor("0xbbb")).toBe("0xq2");
    expect(r.pairs()).toEqual(expect.arrayContaining([{ vault: "0xaaa", queue: "0xq1" }, { vault: "0xbbb", queue: "0xq2" }]));
  });
});
