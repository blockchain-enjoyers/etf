import {
  OracleSource as PrismaOracleSource,
  OracleSeverity as PrismaOracleSeverity,
} from "../generated/prisma/enums.js";
import { MarketStatus, marketStatusToPrisma } from "./market-status.js";

/** Off-chain mirror of OracleTypes.MarketStatus severity (0=Open..4=Unknown). */
export enum OracleSeverity {
  Open = "Open",
  Degraded = "Degraded",
  Halted = "Halted",
  Closed = "Closed",
  Unknown = "Unknown",
}

const SEVERITY_CODE: Record<number, OracleSeverity> = {
  0: OracleSeverity.Open,
  1: OracleSeverity.Degraded,
  2: OracleSeverity.Halted,
  3: OracleSeverity.Closed,
  4: OracleSeverity.Unknown,
};

export function severityFromCode(code: number): OracleSeverity {
  return SEVERITY_CODE[code] ?? OracleSeverity.Unknown;
}

export function severityToVenueStatus(s: OracleSeverity): MarketStatus {
  switch (s) {
    case OracleSeverity.Open:
    case OracleSeverity.Degraded:
      return MarketStatus.Regular;
    case OracleSeverity.Halted:
    case OracleSeverity.Closed:
      return MarketStatus.Closed;
    default:
      return MarketStatus.Unknown;
  }
}

/** Off-chain mirror of MeridianTypes.OracleSource. Also the fusion fallback ordering. [R5] */
export enum OracleSource {
  Chainlink = "Chainlink",
  Pyth = "Pyth",
  RedStone = "RedStone",
  DexTwap = "DexTwap",
  PerpMark = "PerpMark",
  LastClose = "LastClose",
}

/** Normalized reading every OracleAdapter returns. Canonical 18-dec for price + confidence. [R5] */
export interface OracleReading {
  /** 18-dec USD price. */
  price: bigint;
  /** Half-width of the band in price units (Pyth-style); 0n = exact. 18-dec. */
  confidence: bigint;
  /** Seconds since epoch; staleness = now - timestamp. */
  timestamp: number;
  marketStatus: MarketStatus;
  source: OracleSource;
}

/**
 * Result returned by NavEngineService. The IRON RULE lives in `estimated`:
 * estimated === true ⇒ closed/uncertain/halted ⇒ NEVER a settlement price. [R4]
 */
export interface NavResult {
  /** Basket NAV in 18-dec USD. */
  nav: bigint;
  /** nav - band (floored at 0). */
  confidenceLower: bigint;
  /** nav + band. */
  confidenceUpper: bigint;
  marketStatus: MarketStatus;
  source: OracleSource;
  /** true ⇒ closed-market / uncertain ⇒ NEVER a settlement price. */
  estimated: boolean;
  /** Seconds since epoch. */
  timestamp: number;
  /** On-chain severity (L2/L4); undefined on the off-chain path. */
  severity?: OracleSeverity;
  /** L4 verdict; undefined when not read from L4. */
  safe?: boolean;
}

const SCALE_18 = 18;

/** Scale a value from `decimals` to canonical 18-dec. Scales up exactly; scales down by truncation. */
export function normalizeTo18(value: bigint, decimals: number): bigint {
  if (decimals === SCALE_18) return value;
  if (decimals < SCALE_18) return value * 10n ** BigInt(SCALE_18 - decimals);
  return value / 10n ** BigInt(decimals - SCALE_18);
}

export function oracleSourceToPrisma(source: OracleSource): PrismaOracleSource {
  return source as unknown as PrismaOracleSource;
}

/** Shape accepted by Prisma `navSnapshot.create({ data })` (Decimal columns take strings). */
export interface NavSnapshotInput {
  vaultAddress: string;
  nav: string;
  confidenceLower: string;
  confidenceUpper: string;
  marketStatus: ReturnType<typeof marketStatusToPrisma>;
  source: PrismaOracleSource;
  estimated: boolean;
  timestamp: Date;
  severity?: PrismaOracleSeverity | null;
  safe?: boolean | null;
}

/** Convert a NavResult into the Prisma create input (bigints → decimal strings, seconds → Date). */
export function navResultToSnapshotInput(vaultAddress: string, r: NavResult): NavSnapshotInput {
  return {
    vaultAddress,
    nav: r.nav.toString(),
    confidenceLower: r.confidenceLower.toString(),
    confidenceUpper: r.confidenceUpper.toString(),
    marketStatus: marketStatusToPrisma(r.marketStatus),
    source: oracleSourceToPrisma(r.source),
    estimated: r.estimated,
    // Stamp the snapshot at RECORD time (wall-clock), not the oracle observation time: the on-chain
    // L4 reading timestamp is frozen between oracle re-ingests, which would collapse every NAV-history
    // point onto one x-coordinate. Oracle freshness is carried by estimated/safe/severity, not this.
    timestamp: new Date(),
    severity: r.severity ? (r.severity as unknown as PrismaOracleSeverity) : null,
    safe: r.safe ?? null,
  };
}
