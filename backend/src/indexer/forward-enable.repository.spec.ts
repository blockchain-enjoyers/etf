import { describe, it, expect, vi } from "vitest";
import { IndexerRepository } from "./indexer.repository.js";
function fake() {
  const cfg = new Map<string, any>(); const nonces = new Set<string>();
  return {
    _cfg: cfg, _nonces: nonces,
    forwardQueueConfig: {
      upsert: vi.fn(async ({ where, create, update }: any) => { const k = where.vaultAddress; cfg.set(k, cfg.has(k) ? { ...cfg.get(k), ...update } : { ...create }); return cfg.get(k); }),
      findUnique: vi.fn(async ({ where }: any) => cfg.get(where.vaultAddress) ?? null),
      findMany: vi.fn(async ({ where }: any) => [...cfg.values()].filter((r) => r.status === where.status)),
      update: vi.fn(async ({ where, data }: any) => { cfg.set(where.vaultAddress, { ...cfg.get(where.vaultAddress), ...data }); return cfg.get(where.vaultAddress); }),
    },
    forwardEnableNonce: {
      create: vi.fn(async ({ data }: any) => { const k = `${data.vaultAddress}:${data.nonce}`; if (nonces.has(k)) throw new Error("dup"); nonces.add(k); }),
      findUnique: vi.fn(async ({ where }: any) => (nonces.has(`${where.vaultAddress_nonce.vaultAddress}:${where.vaultAddress_nonce.nonce}`) ? {} : null)),
    },
  };
}
const repo = (p: any) => new IndexerRepository(p as never, { ensure: vi.fn() } as never);
describe("ForwardQueueConfig repo", () => {
  it("upsert + getForwardQueueConfig roundtrips", async () => {
    const p = fake(); const r = repo(p);
    await r.upsertForwardQueueConfig({ vaultAddress: "0xV", requestedBy: "0xM", params: { minPrints: 2 } });
    expect((await r.getForwardQueueConfig("0xV"))!.status).toBe("Pending");
  });
  it("getLiveForwardQueues returns only Live rows with vault+queue", async () => {
    const p = fake(); const r = repo(p);
    await r.upsertForwardQueueConfig({ vaultAddress: "0xA", requestedBy: "0xM", params: {} });
    await r.setForwardQueueStatus("0xA", "Live", { queueAddress: "0xQ" });
    await r.upsertForwardQueueConfig({ vaultAddress: "0xB", requestedBy: "0xM", params: {} });
    expect(await r.getLiveForwardQueues()).toEqual([{ vault: "0xA", queue: "0xQ" }]);
  });
  it("markNonceUsed is single-use", async () => {
    const p = fake(); const r = repo(p);
    expect(await r.isNonceUsed("0xV", "1")).toBe(false);
    await r.markNonceUsed("0xV", "1");
    expect(await r.isNonceUsed("0xV", "1")).toBe(true);
  });
});
