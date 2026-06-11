import { Injectable } from "@nestjs/common";

export interface BandInput {
  /** 18-dec NAV. */
  nav: bigint;
  /** 18-dec sum of holdingᵢ·confidenceᵢ (the contract's `band`). */
  summedBand: bigint;
  /** When estimated, widen by ESTIMATED_BAND_BPS of NAV (closed-market uncertainty). */
  estimated: boolean;
}

export interface Band {
  lower: bigint;
  upper: bigint;
}

const BPS_DENOMINATOR = 10_000n;

/**
 * Confidence band around NAV. Base band = Σ holdingᵢ·confidenceᵢ (mirrors the contract). When the
 * reading is estimated (closed/halted/stale), widen by ESTIMATED_BAND_BPS of NAV so the band honestly
 * reflects the extra uncertainty. Lower bound is floored at 0. [spec §6, R4]
 */
@Injectable()
export class ConfidenceService {
  constructor(private readonly estimatedBandBps: number) {}

  band(input: BandInput): Band {
    let band = input.summedBand;
    if (input.estimated) {
      band += (input.nav * BigInt(this.estimatedBandBps)) / BPS_DENOMINATOR;
    }
    const lower = input.nav > band ? input.nav - band : 0n;
    const upper = input.nav + band;
    return { lower, upper };
  }
}
