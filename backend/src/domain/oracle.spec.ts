import { describe, expect, it } from "vitest";
import { MarketStatus } from "./market-status.js";
import {
  OracleSource,
  OracleSeverity,
  navResultToSnapshotInput,
  normalizeTo18,
  oracleSourceToPrisma,
  severityFromCode,
  severityToVenueStatus,
} from "./oracle.js";

describe("normalizeTo18", () => {
  it("scales an 8-dec Chainlink price up to 18-dec", () => {
    // 123.45 at 8 decimals = 12_345_000_000
    expect(normalizeTo18(12_345_000_000n, 8)).toBe(123_450_000_000_000_000_000n);
  });

  it("leaves an already-18-dec value untouched", () => {
    expect(normalizeTo18(5_000_000_000_000_000_000n, 18)).toBe(5_000_000_000_000_000_000n);
  });

  it("scales a 6-dec value (USDC-style) up to 18-dec", () => {
    expect(normalizeTo18(1_000_000n, 6)).toBe(1_000_000_000_000_000_000n);
  });

  it("truncates when scaling DOWN from more than 18 decimals", () => {
    // 1.0 at 20 decimals = 1e20; down to 18 = 1e18
    expect(normalizeTo18(100_000_000_000_000_000_000n, 20)).toBe(1_000_000_000_000_000_000n);
  });
});

describe("oracleSourceToPrisma", () => {
  it("maps every source to its Prisma enum string", () => {
    expect(oracleSourceToPrisma(OracleSource.Chainlink)).toBe("Chainlink");
    expect(oracleSourceToPrisma(OracleSource.Pyth)).toBe("Pyth");
    expect(oracleSourceToPrisma(OracleSource.LastClose)).toBe("LastClose");
  });
});

describe("navResultToSnapshotInput", () => {
  it("encodes bigints as decimal strings and the timestamp as a Date", () => {
    const input = navResultToSnapshotInput("0xabc", {
      nav: 1_000_000_000_000_000_000n,
      confidenceLower: 990_000_000_000_000_000n,
      confidenceUpper: 1_010_000_000_000_000_000n,
      marketStatus: MarketStatus.Regular,
      source: OracleSource.Chainlink,
      estimated: false,
      timestamp: 1_750_000_000,
    });
    expect(input.vaultAddress).toBe("0xabc");
    expect(input.nav).toBe("1000000000000000000");
    expect(input.confidenceLower).toBe("990000000000000000");
    expect(input.marketStatus).toBe("Regular");
    expect(input.source).toBe("Chainlink");
    expect(input.estimated).toBe(false);
    // Snapshot is stamped at record time (wall-clock), not the oracle observation time.
    expect(input.timestamp).toBeInstanceOf(Date);
  });
});

describe("on-chain severity", () => {
  it("maps uint8 codes to severity (0..4), out-of-range -> Unknown", () => {
    expect(severityFromCode(0)).toBe(OracleSeverity.Open);
    expect(severityFromCode(3)).toBe(OracleSeverity.Closed);
    expect(severityFromCode(99)).toBe(OracleSeverity.Unknown);
  });
  it("maps severity to a venue status for display", () => {
    expect(severityToVenueStatus(OracleSeverity.Open)).toBe(MarketStatus.Regular);
    expect(severityToVenueStatus(OracleSeverity.Halted)).toBe(MarketStatus.Closed);
    expect(severityToVenueStatus(OracleSeverity.Unknown)).toBe(MarketStatus.Unknown);
  });
  it("snapshot input carries severity + safe when present", () => {
    const input = navResultToSnapshotInput("0xv", {
      nav: 1n, confidenceLower: 0n, confidenceUpper: 2n,
      marketStatus: MarketStatus.Regular, source: 0 as never, estimated: false,
      timestamp: 1, severity: OracleSeverity.Open, safe: true,
    } as never);
    expect(input.severity).toBe("Open");
    expect(input.safe).toBe(true);
  });
});
