import { describe, it, expect, vi } from "vitest";
import { ForwardEnableService, ForwardEnableConflict } from "./forward-enable.service.js";
import type { EnableParams } from "./forward-enable.params.js";
const params: EnableParams = { minPrints: 2, twapWindowSec: 600, twapBandBps: 200, pegBandBps: 200, pegMaxAgeSec: 3600, cutoffDelaySec: 600, spreadBps: 0, capacityBps: 0, keeperTip: "0", keeperBps: 0 };
function mk(existing: any = null) {
  const repo = { getForwardQueueConfig: vi.fn(async () => existing), upsertForwardQueueConfig: vi.fn(async () => {}) };
  const auth = { verify: vi.fn(async () => "0xMANAGER") };
  const boss = { send: vi.fn(async () => {}) };
  return { svc: new ForwardEnableService(repo as never, auth as never, boss as never), repo, auth, boss };
}
const sig = { nonce: "1", expiry: 9, signature: "0x" as const };
describe("ForwardEnableService", () => {
  it("rejects out-of-cap param", async () => { const { svc } = mk(); await expect(svc.enable("0xV", { ...params, keeperBps: 5000 }, sig)).rejects.toThrow(/keeperBps/); });
  it("409 when already Live", async () => { const { svc } = mk({ status: "Live" }); await expect(svc.enable("0xV", params, sig)).rejects.toBeInstanceOf(ForwardEnableConflict); });
  it("enqueues + returns pending; requestedBy from auth", async () => { const { svc, boss, auth, repo } = mk(null); const r = await svc.enable("0xV", params, sig); expect(auth.verify).toHaveBeenCalled(); expect(repo.upsertForwardQueueConfig).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: "0xMANAGER" })); expect(boss.send).toHaveBeenCalled(); expect(r.status).toBe("pending"); });
  it("allows retry when Failed", async () => { const { svc, boss } = mk({ status: "Failed" }); await svc.enable("0xV", params, sig); expect(boss.send).toHaveBeenCalled(); });
  it("status maps row to wire", async () => { const { svc } = mk({ status: "Live", queueAddress: "0xQ", step: "settler" }); expect(await svc.status("0xV")).toEqual({ status: "live", queueAddress: "0xQ", step: "settler" }); });
});
