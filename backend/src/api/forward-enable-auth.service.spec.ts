import { describe, it, expect, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ForwardEnableAuthService } from "./forward-enable-auth.service.js";
import { paramsHashOf, type EnableParams } from "./forward-enable.params.js";
const PK = `0x${"22".repeat(32)}` as const; const acct = privateKeyToAccount(PK);
const params: EnableParams = { minPrints: 2, twapWindowSec: 600, twapBandBps: 200, pegBandBps: 200, pegMaxAgeSec: 3600, cutoffDelaySec: 600, spreadBps: 0, capacityBps: 0, keeperTip: "0", keeperBps: 0 };
const VAULT = "0x000000000000000000000000000000000000bEEF";
function svc(manager: string, used = false) {
  const reader = { manager: vi.fn(async () => manager) };
  const repo = { isNonceUsed: vi.fn(async () => used), markNonceUsed: vi.fn(async () => {}) };
  const chain = { chain: { id: 46630 } };
  return { s: new ForwardEnableAuthService(reader as never, repo as never, chain as never, { nowSec: () => 1000 }), repo };
}
async function sign(expiry = 9999) {
  return acct.signTypedData({ domain: { name: "Meridian", version: "1", chainId: 46630, verifyingContract: VAULT as `0x${string}` },
    types: { EnableCashSettlement: [ { name: "vault", type: "address" }, { name: "paramsHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" } ] },
    primaryType: "EnableCashSettlement", message: { vault: VAULT, paramsHash: paramsHashOf(params), nonce: 1n, expiry: BigInt(expiry) } });
}
describe("ForwardEnableAuthService", () => {
  it("accepts manager signature + marks nonce + returns manager", async () => {
    const { s, repo } = svc(acct.address);
    await expect(s.verify(VAULT, params, { nonce: "1", expiry: 9999, signature: await sign() })).resolves.toBe(acct.address);
    expect(repo.markNonceUsed).toHaveBeenCalledWith(VAULT, "1");
  });
  it("rejects non-manager", async () => { const { s } = svc("0x000000000000000000000000000000000000dEaD"); await expect(s.verify(VAULT, params, { nonce: "1", expiry: 9999, signature: await sign() })).rejects.toThrow(/manager/i); });
  it("rejects expired", async () => { const { s } = svc(acct.address); await expect(s.verify(VAULT, params, { nonce: "1", expiry: 500, signature: await sign(500) })).rejects.toThrow(/expired/i); });
  it("rejects replayed nonce", async () => { const { s } = svc(acct.address, true); await expect(s.verify(VAULT, params, { nonce: "1", expiry: 9999, signature: await sign() })).rejects.toThrow(/nonce/i); });
});
