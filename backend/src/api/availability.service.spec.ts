import { describe, expect, it, vi } from "vitest";
import { AvailabilityService } from "./availability.service.js";

function svcWith(basket: unknown, snap: unknown = null) {
  const prisma = {
    basket: { findUnique: vi.fn().mockResolvedValue(basket) },
    navSnapshot: { findFirst: vi.fn().mockResolvedValue(snap) },
  };
  return new AvailabilityService(prisma as never);
}

describe("AvailabilityService", () => {
  it("mint disabled+frozen when basket frozen; redeemInKind always enabled (IRON RULE)", async () => {
    const items = (await svcWith({ vaultAddress: "0xv", frozen: true, manager: null }).availability("0xv", null)).items;
    expect(items.find((i) => i.action === "mint")!).toMatchObject({ enabled: false, reason: "frozen" });
    expect(items.find((i) => i.action === "redeemInKind")!).toMatchObject({ enabled: true, reason: "ok" });
  });

  it("curatorSchedule manager-mismatch when account != manager (rebalance vault)", async () => {
    const items = (await svcWith({ vaultAddress: "0xv", frozen: false, manager: "0xMANAGER", vaultType: "Rebalance" }).availability("0xv", "0xstranger")).items;
    expect(items.find((i) => i.action === "curatorSchedule")!.reason).toBe("manager-mismatch");
  });

  it("curatorSchedule ok when account == manager (case-insensitive, rebalance vault)", async () => {
    const items = (await svcWith({ vaultAddress: "0xv", frozen: false, manager: "0xMANAGER", vaultType: "Rebalance" }).availability("0xv", "0xmanager")).items;
    expect(items.find((i) => i.action === "curatorSchedule")!).toMatchObject({ enabled: true, reason: "ok" });
  });

  it("all not-deployed when basket missing", async () => {
    const items = (await svcWith(null).availability("0xv", null)).items;
    expect(items.every((i) => i.reason === "not-deployed")).toBe(true);
  });

  it("non-rebalance vault: forward/curator/keeper/auction disabled with unsupported-vault-type; mint+redeemInKind unaffected", async () => {
    // A basket-type vault is the manager so a manager-based gate could pass — the vaultType gate must win.
    const items = (await svcWith({ vaultAddress: "0xv", frozen: false, manager: "0xMANAGER", vaultType: "Basket" }).availability("0xv", "0xmanager")).items;
    const gated = ["forwardCreate", "forwardRedeem", "forwardCancel", "curatorSchedule", "curatorActivate", "keeperRecord", "keeperSettle", "auctionOpen", "auctionBid", "auctionSetExecMode"] as const;
    for (const action of gated) {
      expect(items.find((i) => i.action === action)!).toMatchObject({ enabled: false, reason: "unsupported-vault-type" });
    }
    // IRON RULE: in-kind redeem never gated; mint follows frozen only; deploy stays open.
    expect(items.find((i) => i.action === "redeemInKind")!).toMatchObject({ enabled: true, reason: "ok" });
    expect(items.find((i) => i.action === "mint")!).toMatchObject({ enabled: true, reason: "ok" });
    expect(items.find((i) => i.action === "deploy")!).toMatchObject({ enabled: true, reason: "ok" });
  });

  it("rebalance vault keeps per-action keeper/forward logic (keeperRecord gated on account)", async () => {
    const noAcct = (await svcWith({ vaultAddress: "0xv", frozen: false, manager: "0xMANAGER", vaultType: "Rebalance" }).availability("0xv", null)).items;
    expect(noAcct.find((i) => i.action === "keeperRecord")!).toMatchObject({ enabled: false, reason: "not-authorized" });
    expect(noAcct.find((i) => i.action === "forwardCreate")!).toMatchObject({ enabled: true, reason: "ok" });
  });
});
