import { describe, expect, it, vi } from "vitest";
import { SignalPollHandler } from "./signal-poll.handler.js";

describe("SignalPollHandler", () => {
  it("persists a PriceSnapshot for a usable reading", async () => {
    const prisma = {
      constituent: { findMany: vi.fn().mockResolvedValue([{ token: "0xa" }]) },
      priceSnapshot: { create: vi.fn() },
    };
    const signals = {
      getReading: vi.fn().mockResolvedValue({
        price: 300_000000000000000000n,
        confidence: 1_000000000000000000n,
        timestamp: 1_717_000_000,
        marketStatus: "Regular",
        source: "ChainlinkDS",
        estimated: false,
      }),
    };
    const h = new SignalPollHandler(signals as never, prisma as never);
    await h.run();
    expect(prisma.priceSnapshot.create).toHaveBeenCalledTimes(1);
  });

  it("skips persisting zero-price (synthesized fallback) readings", async () => {
    const prisma = {
      constituent: { findMany: vi.fn().mockResolvedValue([{ token: "0xa" }]) },
      priceSnapshot: { create: vi.fn() },
    };
    const signals = {
      getReading: vi.fn().mockResolvedValue({
        price: 0n,
        confidence: 0n,
        timestamp: 1,
        marketStatus: "Unknown",
        source: "LastClose",
        estimated: true,
      }),
    };
    const h = new SignalPollHandler(signals as never, prisma as never);
    await h.run();
    expect(prisma.priceSnapshot.create).not.toHaveBeenCalled();
  });
});
