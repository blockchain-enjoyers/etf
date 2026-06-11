import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, encodeAbiParameters, keccak256, recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PayloadSignerService } from "./payload-signer.service.js";

const PK = `0x${"11".repeat(32)}` as const;
const TOKEN = "0x000000000000000000000000000000000000000a";

function make(snaps: { regular?: { price: string; tsSec: number }; latest?: { price: string } }) {
  const prisma = {
    priceSnapshot: {
      findFirst: vi.fn(async (args: { where: { marketStatus?: string } }) =>
        args.where.marketStatus === "Regular"
          ? snaps.regular
            ? {
                price: { toFixed: () => snaps.regular!.price },
                timestamp: new Date(snaps.regular!.tsSec * 1000),
              }
            : null
          : snaps.latest
            ? { price: { toFixed: () => snaps.latest!.price }, timestamp: new Date() }
            : null,
      ),
    },
  };
  const chain = { account: privateKeyToAccount(PK) };
  return new PayloadSignerService(prisma as never, chain as never, {
    depth: 5_000_000n * 10n ** 18n,
    nowSec: () => 1_780_000_500,
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

describe("PayloadSignerService", () => {
  it("signs a payload the contract's ecrecover accepts (raw digest, no EIP-191 prefix)", async () => {
    const svc = make({
      regular: { price: "300000000000000000000", tsSec: 1_780_000_000 },
      latest: { price: "301000000000000000000" },
    });
    const [weekday] = await svc.payloadsFor(TOKEN);
    const [feedId, price, depth, lastUpdate, sr, ss, sv] = decodeAbiParameters(
      PAYLOAD_TYPES,
      weekday,
    );
    expect(price).toBe(300_000000000000000000n);
    expect(lastUpdate).toBe(1_780_000_000n);
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

  it("weekend payload uses the latest snapshot price with fresh lastUpdate", async () => {
    const svc = make({
      regular: { price: "300000000000000000000", tsSec: 1_780_000_000 },
      latest: { price: "299000000000000000000" },
    });
    const [, weekend] = await svc.payloadsFor(TOKEN);
    const [, price, , lastUpdate] = decodeAbiParameters(PAYLOAD_TYPES, weekend);
    expect(price).toBe(299_000000000000000000n);
    // lastUpdate is dated SKEW_BUFFER_SEC (120s) before nowSec so the aggregator's unguarded
    // `block.timestamp - lastUpdate` can't underflow on backend↔L2 clock lead.
    expect(lastUpdate).toBe(1_780_000_500n - 120n);
  });

  it("throws a clear error when no usable snapshot exists", async () => {
    const svc = make({});
    await expect(svc.payloadsFor(TOKEN)).rejects.toThrow(/no price/i);
  });
});
