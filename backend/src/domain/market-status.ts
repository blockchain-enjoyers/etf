import { MarketStatus as PrismaMarketStatus } from "../generated/prisma/enums.js";

/**
 * Off-chain mirror of MeridianTypes.MarketStatus (contracts/src/types/MeridianTypes.sol).
 * Codes 0-5 match the Chainlink Equities Data Streams marketStatus field. [spec §6, R5]
 */
export enum MarketStatus {
  Unknown = "Unknown",
  PreMarket = "PreMarket",
  Regular = "Regular",
  PostMarket = "PostMarket",
  Overnight = "Overnight",
  Closed = "Closed",
}

const CODE_TO_STATUS: Record<number, MarketStatus> = {
  0: MarketStatus.Unknown,
  1: MarketStatus.PreMarket,
  2: MarketStatus.Regular,
  3: MarketStatus.PostMarket,
  4: MarketStatus.Overnight,
  5: MarketStatus.Closed,
};

/** Map a feed marketStatus code (0-5) to the enum; anything else is degraded → Unknown (never throws). */
export function marketStatusFromFeedCode(code: number): MarketStatus {
  return CODE_TO_STATUS[code] ?? MarketStatus.Unknown;
}

/** Regular is the only state v1 trusts for settlement-grade pricing / rebalance. [R5] */
export function isTradeable(status: MarketStatus): boolean {
  return status === MarketStatus.Regular;
}

/** The enum value equals the Prisma enum string, but cross via these helpers to keep the boundary explicit. */
export function marketStatusToPrisma(status: MarketStatus): PrismaMarketStatus {
  return status as unknown as PrismaMarketStatus;
}

export function prismaToMarketStatus(status: PrismaMarketStatus): MarketStatus {
  return status as unknown as MarketStatus;
}
