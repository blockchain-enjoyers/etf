import { Injectable } from "@nestjs/common";
import type { AvailabilityResponse, TxAction } from "@meridian/sdk";
import { PrismaService } from "../persistence/prisma.service.js";

const ALL_ACTIONS: TxAction[] = [
  "mint", "redeemInKind", "deploy",
  "forwardCreate", "forwardRedeem", "forwardCancel",
  "curatorSchedule", "curatorActivate",
  "keeperRecord", "keeperSettle",
  "auctionOpen", "auctionBid", "auctionSetExecMode",
];

// Forward/curator/keeper/auction actions live only on the ManagedRebalanceVault; on every other
// vault type they are structurally unsupported (in-kind mint/redeem stay enabled — IRON RULE).
const REBALANCE_ONLY_ACTIONS: TxAction[] = [
  "forwardCreate", "forwardRedeem", "forwardCancel",
  "curatorSchedule", "curatorActivate",
  "keeperRecord", "keeperSettle",
  "auctionOpen", "auctionBid", "auctionSetExecMode",
];
const NON_REBALANCE_ITEMS: AvailabilityResponse["items"] = REBALANCE_ONLY_ACTIONS.map((action) => ({
  action,
  enabled: false,
  reason: "unsupported-vault-type",
}));

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async availability(vault: string, account: string | null): Promise<AvailabilityResponse> {
    const basket = await this.prisma.basket.findUnique({ where: { vaultAddress: vault } });
    if (!basket) {
      return { vaultAddress: vault, account, items: ALL_ACTIONS.map((action) => ({ action, enabled: false, reason: "not-deployed" })) };
    }
    const snap = await this.prisma.navSnapshot.findFirst({ where: { vaultAddress: vault }, orderBy: { timestamp: "desc" } });
    const frozen = basket.frozen;
    const halted = snap?.severity === "Halted";
    const isManager = !!account && !!basket.manager && account.toLowerCase() === basket.manager.toLowerCase();
    const hasAccount = !!account;
    // Forward/curator/keeper/auction surfaces only exist on the ManagedRebalanceVault. For every
    // other vault type they are structurally absent — gate them off so the FE never offers them.
    const isRebalance = basket.vaultType === "Rebalance";

    const items: AvailabilityResponse["items"] = [
      { action: "redeemInKind", enabled: true, reason: "ok" }, // IRON RULE: never gated
      { action: "mint", enabled: !frozen, reason: frozen ? "frozen" : "ok" },
      { action: "deploy", enabled: true, reason: "ok" },
      ...(isRebalance ? this.rebalanceItems({ frozen, halted, isManager, hasAccount }) : NON_REBALANCE_ITEMS),
    ];
    return { vaultAddress: vault, account, items };
  }

  private rebalanceItems(
    s: { frozen: boolean; halted: boolean; isManager: boolean; hasAccount: boolean },
  ): AvailabilityResponse["items"] {
    const { frozen, halted, isManager, hasAccount } = s;
    return [
      { action: "forwardCreate", enabled: !frozen && !halted, reason: frozen ? "frozen" : halted ? "halted" : "ok" },
      { action: "forwardRedeem", enabled: !frozen && !halted, reason: frozen ? "frozen" : halted ? "halted" : "ok" },
      { action: "forwardCancel", enabled: true, reason: "ok" },
      { action: "curatorSchedule", enabled: isManager, reason: isManager ? "ok" : "manager-mismatch" },
      { action: "curatorActivate", enabled: isManager, reason: isManager ? "ok" : "manager-mismatch" },
      { action: "auctionOpen", enabled: isManager, reason: isManager ? "ok" : "manager-mismatch" },
      { action: "auctionSetExecMode", enabled: isManager, reason: isManager ? "ok" : "manager-mismatch" },
      { action: "keeperRecord", enabled: hasAccount, reason: hasAccount ? "ok" : "not-authorized" },
      { action: "keeperSettle", enabled: hasAccount, reason: hasAccount ? "ok" : "not-authorized" },
      { action: "auctionBid", enabled: hasAccount, reason: hasAccount ? "ok" : "not-authorized" },
    ];
  }
}
