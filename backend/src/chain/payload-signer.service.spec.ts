import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, encodeAbiParameters, keccak256, recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PayloadSignerService } from "./payload-signer.service.js";

const PK = `0x${"11".repeat(32)}` as const;
const TOKEN = "0x000000000000000000000000000000000000000a";

function make(
  latest: { price: string; tsSec: number } | null,
  opts: { nowSec: number; forceOpen?: boolean },
) {
  const prisma = {
    priceSnapshot: {
      findFirst: vi.fn(async () =>
        latest
          ? { price: { toFixed: () => latest.price }, timestamp: new Date(latest.tsSec * 1000) }
          : null,
      ),
    },
  };
  const chain = { account: privateKeyToAccount(PK) };
  return new PayloadSignerService(prisma as never, chain as never, {
    depth: 5_000_000n * 10n ** 18n,
    nowSec: () => opts.nowSec,
    forceOpen: () => opts.forceOpen ?? false,
  });
}

const PAYLOAD_TYPES = [
  { type: "bytes32" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint64" },
  { type: "bytes32[]" },
  { type: "bytes32[]" },
  { type: "uint8[]" },
] as const;

// Sunday in ET → marketStatusNow() returns Closed deterministically (no holiday table needed).
const CLOSED_NOW = Math.floor(new Date("2026-01-04T12:00:00Z").getTime() / 1000);

describe("PayloadSignerService", () => {
  it("signs a payload the contract's ecrecover accepts (raw digest, no EIP-191 prefix)", async () => {
    const svc = make(
      { price: "300000000000000000000", tsSec: 1_780_000_000 },
      { nowSec: 1_780_000_500, forceOpen: true },
    );
    const [weekday] = await svc.payloadsFor(TOKEN);
    const [feedId, price, depth, lastUpdate, sr, ss, sv] = decodeAbiParameters(
      PAYLOAD_TYPES,
      weekday,
    );
    expect(price).toBe(300_000000000000000000n);
    expect(lastUpdate).toBe(1_780_000_500n); // live ⇒ wall-clock now (snapshot price, not its market ts)
    const digest = keccak256(
      encodeAbiParameters(
        [
          { type: "string" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint64" },
        ],
        ["universal", feedId, price, depth, lastUpdate],
      ),
    );
    const recovered = await recoverAddress({
      hash: digest,
      signature: { r: sr[0]!, s: ss[0]!, v: BigInt(sv[0]!) },
    });
    expect(recovered.toLowerCase()).toBe(privateKeyToAccount(PK).address.toLowerCase());
  });

  it("weekend leg is always fresh (snapshot ts capped at now)", async () => {
    const svc = make(
      { price: "299000000000000000000", tsSec: 1_780_000_000 },
      { nowSec: 1_780_000_500, forceOpen: false },
    );
    const [, weekend] = await svc.payloadsFor(TOKEN);
    const [, price, , lastUpdate] = decodeAbiParameters(PAYLOAD_TYPES, weekend);
    expect(price).toBe(299_000000000000000000n);
    expect(lastUpdate).toBe(1_780_000_500n); // weekend leg is always live ⇒ wall-clock now
  });

  it("back-dates the weekday leg when the market is closed and not forced ⇒ honest Closed", async () => {
    const svc = make(
      { price: "300000000000000000000", tsSec: CLOSED_NOW - 5 },
      { nowSec: CLOSED_NOW, forceOpen: false },
    );
    const [weekday] = await svc.payloadsFor(TOKEN);
    const [, , , lastUpdate] = decodeAbiParameters(PAYLOAD_TYPES, weekday);
    expect(lastUpdate).toBe(BigInt(CLOSED_NOW - 86_400)); // aggregator staleHorizon drops it
  });

  it("keeps the weekday leg fresh off-hours when MARKET_FORCE_OPEN is set", async () => {
    const svc = make(
      { price: "300000000000000000000", tsSec: CLOSED_NOW - 5 },
      { nowSec: CLOSED_NOW, forceOpen: true },
    );
    const [weekday] = await svc.payloadsFor(TOKEN);
    const [, , , lastUpdate] = decodeAbiParameters(PAYLOAD_TYPES, weekday);
    expect(lastUpdate).toBe(BigInt(CLOSED_NOW)); // forced live ⇒ wall-clock now
  });

  it("throws a clear error when no usable snapshot exists", async () => {
    const svc = make(null, { nowSec: 1_780_000_500 });
    await expect(svc.payloadsFor(TOKEN)).rejects.toThrow(/no price/i);
  });
});
