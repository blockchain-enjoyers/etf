import { Injectable } from "@nestjs/common";
import { encodeAbiParameters, keccak256, padHex, parseSignature } from "viem";
import { PrismaService } from "../persistence/prisma.service.js";
import { ChainService } from "./chain.service.js";
import { marketStatusNow } from "../signals/market-calendar.js";
import { MarketStatus } from "../domain/market-status.js";

export interface PayloadSignerOptions {
  depth: bigint;
  nowSec: () => number;
  /** Testnet demo flag: force the weekday leg live (market treated Regular) regardless of wall-clock. */
  forceOpen?: () => boolean;
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
 * Off-hours, the weekday leg is dated this far in the past so the aggregator's staleHorizon drops it,
 * leaving only the (weekendAware) weekend leg → marketStatus Closed. This is what keeps a closed-market
 * read honest (estimated): the weekday leg is the ONLY non-weekendAware source, so its liveness is the
 * Open/Closed switch [spec §10, R5 iron rule].
 */
const STALE_BACKDATE_SEC = 86_400;

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

    const latest = await this.prisma.priceSnapshot.findFirst({
      where: { token, price: { gt: 0 } },
      orderBy: { timestamp: "desc" },
    });
    if (!latest) throw new Error(`payload-signer: no price snapshot for ${token}`);

    const feedId = padHex(token as `0x${string}`, { size: 32 });
    const nowS = this.opts.nowSec();
    const price = BigInt(latest.price.toFixed(0));
    // The on-chain payload's lastUpdate must reflect WALL-CLOCK freshness, NOT the snapshot's source
    // timestamp: the 24/7 demo feed is a last-close FV walk, so the snapshot ts is an old market time
    // the aggregator's staleHorizon would reject. The F3 guard tolerates a sub-second backend↔L2 lead,
    // so the old now-120 skew clamp is gone. Open/Closed comes from the calendar gate below.
    const liveTs = nowS;

    // The weekday (non-weekendAware) leg drives the Open verdict. It is live ONLY during regular
    // US-equity hours (or under the testnet MARKET_FORCE_OPEN flag); otherwise back-date it so the
    // aggregator filters it as stale → only the weekend leg survives → Closed (estimated).
    const forceOpen = this.opts.forceOpen?.() ?? false;
    const marketOpen = forceOpen || marketStatusNow(new Date(nowS * 1000)) === MarketStatus.Regular;
    const weekdayTs = marketOpen ? liveTs : nowS - STALE_BACKDATE_SEC;

    const weekday = await this.signOne(sign, feedId, price, BigInt(weekdayTs));
    const weekend = await this.signOne(sign, feedId, price, BigInt(liveTs));
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
