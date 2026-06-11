import { Injectable } from "@nestjs/common";
import { encodeAbiParameters, keccak256, padHex, parseSignature } from "viem";
import { PrismaService } from "../persistence/prisma.service.js";
import { ChainService } from "./chain.service.js";

export interface PayloadSignerOptions {
  depth: bigint;
  nowSec: () => number;
}

type RawSign = (p: { hash: `0x${string}` }) => Promise<`0x${string}`>;

const DIGEST_TYPES = [
  { type: "string" },
  { type: "bytes32" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint64" },
] as const;
const PAYLOAD_TYPES = [
  { type: "bytes32" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint64" },
  { type: "bytes32[]" },
  { type: "bytes32[]" },
  { type: "uint8[]" },
] as const;

/**
 * Date every signed reading this many seconds in the past. The aggregator computes
 * `block.timestamp - lastUpdate` UNGUARDED (PriceAggregator.priceOf / acceptedDepthOf), so a reading
 * dated ahead of the L2 block clock — even by the sub-second backend↔sequencer lead — underflows and
 * reverts the whole read ("arithmetic underflow or overflow"). The buffer stays far inside staleHorizon
 * (3600s), so sources remain fresh. The robust fix is to guard the subtraction on-chain (needs redeploy).
 */
const SKEW_BUFFER_SEC = 120;

@Injectable()
export class PayloadSignerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
    private readonly opts: PayloadSignerOptions = {
      depth: 5_000_000n * 10n ** 18n,
      nowSec: () => Math.floor(Date.now() / 1000),
    },
  ) {}

  /** [weekdayPayload, weekendPayload] — order matches the aggregator source registration (spec §1). */
  async payloadsFor(token: string): Promise<[`0x${string}`, `0x${string}`]> {
    const account = this.chain.account;
    if (!account || !("sign" in account) || !account.sign) {
      throw new Error("payload-signer: KEEPER_PRIVATE_KEY required");
    }
    const sign: RawSign = account.sign.bind(account);
    const regular = await this.prisma.priceSnapshot.findFirst({
      where: { token, marketStatus: "Regular", price: { gt: 0 } },
      orderBy: { timestamp: "desc" },
    });
    const latest = await this.prisma.priceSnapshot.findFirst({
      where: { token, price: { gt: 0 } },
      orderBy: { timestamp: "desc" },
    });
    if (!latest && !regular) throw new Error(`payload-signer: no price snapshot for ${token}`);
    const feedId = padHex(token as `0x${string}`, { size: 32 });
    // Never date a payload after (now - buffer): the aggregator's `block.timestamp - lastUpdate` is
    // unguarded, so a future-dated reading underflows the read. Clamp both legs (a fresh market-hours
    // snapshot is as at-risk as the weekend "now").
    const cap = this.opts.nowSec() - SKEW_BUFFER_SEC;
    const weekdayTs = Math.min(
      Math.floor((regular ?? latest)!.timestamp.getTime() / 1000),
      cap,
    );
    const weekday = await this.signOne(
      sign,
      feedId,
      BigInt((regular ?? latest)!.price.toFixed(0)),
      BigInt(weekdayTs),
    );
    const weekend = await this.signOne(
      sign,
      feedId,
      BigInt((latest ?? regular)!.price.toFixed(0)),
      BigInt(cap),
    );
    return [weekday, weekend];
  }

  private async signOne(
    sign: RawSign,
    feedId: `0x${string}`,
    price: bigint,
    lastUpdate: bigint,
  ): Promise<`0x${string}`> {
    // RAW digest signed via account.sign — EIP-191 (signMessage) would break the contract's ecrecover.
    const digest = keccak256(
      encodeAbiParameters(DIGEST_TYPES, ["universal", feedId, price, this.opts.depth, lastUpdate]),
    );
    const sig = parseSignature(await sign({ hash: digest }));
    const v = Number(sig.v ?? BigInt(sig.yParity + 27));
    return encodeAbiParameters(PAYLOAD_TYPES, [
      feedId,
      price,
      this.opts.depth,
      lastUpdate,
      [sig.r],
      [sig.s],
      [v],
    ]);
  }
}
