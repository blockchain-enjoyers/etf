import { describe, it, expect } from "vitest";
import { resolveKeeperEscrow } from "./keeper-escrow.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const MANAGER = "0x1111111111111111111111111111111111111111" as const;
const ESCROW = "0x2222222222222222222222222222222222222222";

describe("resolveKeeperEscrow", () => {
  it("defaults an unset escrow to the manager when keeperBps > 0 (avoids ZeroEscrow)", () => {
    expect(resolveKeeperEscrow(1000, undefined, MANAGER)).toBe(MANAGER);
    expect(resolveKeeperEscrow(1000, "", MANAGER)).toBe(MANAGER);
    expect(resolveKeeperEscrow(1000, ZERO, MANAGER)).toBe(MANAGER);
  });

  it("keeps an explicit escrow address", () => {
    expect(resolveKeeperEscrow(1000, ESCROW, MANAGER)).toBe(ESCROW);
  });

  it("leaves escrow zero when there is no keeper fee", () => {
    expect(resolveKeeperEscrow(0, undefined, MANAGER)).toBe(ZERO);
    expect(resolveKeeperEscrow(0, ZERO, MANAGER)).toBe(ZERO);
  });
});
