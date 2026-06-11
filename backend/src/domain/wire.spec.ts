import { marketStatusSchema, oracleSourceSchema } from "@meridian/sdk";
import { describe, expect, it } from "vitest";
import { MarketStatus } from "./market-status.js";
import { OracleSource } from "./oracle.js";
import { marketStatusToWire, oracleSourceToWire, severityToWire, severityToVenue, vaultTypeToWire } from "./wire.js";

describe("wire mappings", () => {
  it("maps EVERY MarketStatus member to a valid SDK wire form", () => {
    for (const v of Object.values(MarketStatus)) {
      expect(marketStatusSchema.safeParse(marketStatusToWire(v)).success).toBe(true);
    }
  });

  it("maps EVERY OracleSource member to a valid SDK wire form", () => {
    for (const v of Object.values(OracleSource)) {
      expect(oracleSourceSchema.safeParse(oracleSourceToWire(v)).success).toBe(true);
    }
  });

  it("maps RedStone -> redstone (regression: char-lowercasing produced redStone)", () => {
    expect(oracleSourceToWire(OracleSource.RedStone)).toBe("redstone");
  });

  it("throws on an unknown value", () => {
    expect(() => marketStatusToWire("Nope")).toThrow();
    expect(() => oracleSourceToWire("Nope")).toThrow();
  });
});

describe("severity + vault-type wire mapping", () => {
  it("maps on-chain severity to wire strings", () => {
    expect(severityToWire("Open")).toBe("open");
    expect(severityToWire("Halted")).toBe("halted");
    expect(severityToWire("Unknown")).toBe("unknown");
  });
  it("maps severity to a venue label for display", () => {
    expect(severityToVenue("Open")).toBe("regular");
    expect(severityToVenue("Degraded")).toBe("regular");
    expect(severityToVenue("Halted")).toBe("closed");
    expect(severityToVenue("Closed")).toBe("closed");
    expect(severityToVenue("Unknown")).toBe("unknown");
  });
  it("maps prisma vault type to wire", () => {
    expect(vaultTypeToWire("Basket")).toBe("basket");
    expect(vaultTypeToWire("Managed")).toBe("managed");
    expect(vaultTypeToWire("Committed")).toBe("committed");
    expect(vaultTypeToWire("Rebalance")).toBe("rebalance");
  });
  it("throws on unknown inputs", () => {
    expect(() => severityToWire("Nope")).toThrow();
    expect(() => vaultTypeToWire("Nope")).toThrow();
  });
});
