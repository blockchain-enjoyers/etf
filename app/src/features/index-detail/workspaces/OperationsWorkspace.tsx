import { useAccount, useChainId } from "wagmi";
import { addresses } from "@meridian/contracts";
import type { BasketDetail } from "@meridian/sdk";
import { Module } from "../../../components/Module";
import { Aud } from "../../../components/Aud";
import { IconChecklist, IconClock, IconCoins } from "../../../components/icons";
import { Chip } from "../../../components/Chip";
import { GateBanner } from "../../../components/GateBanner";
import { useCapabilities } from "../../../capabilities/use-capabilities";
import { useRebalanceDetail } from "../../../data/useRebalanceDetail";
import { useForwardTickets } from "../../../data/useForwardTickets";
import { useSettleGateStatus } from "../../../data/useSettleGateStatus";
import { useKeeperStatus } from "../../../data/useKeeperStatus";
import { useForwardQueue } from "../../../data/useForwardQueue";
import { SettleReadinessPanel } from "../SettleReadinessPanel";
import { ForwardKeeperPanel } from "../ForwardKeeperPanel";
import { KeeperPanel } from "../KeeperPanel";
import { EnableCashSettlementPanel } from "../EnableCashSettlementPanel";
import { DemoPriceSafetyPanel } from "../DemoPriceSafetyPanel";

export function OperationsWorkspace({ vaultAddress, basket }: { vaultAddress: string; basket: BasketDetail }) {
  const enabled = basket.vaultType === "rebalance";
  const { address } = useAccount();
  const chainId = useChainId();
  const manager = basket.manager ?? "";

  const { data: rebalance } = useRebalanceDetail(vaultAddress, enabled);
  const { data: tickets } = useForwardTickets(vaultAddress, address ?? undefined, enabled);
  const { data: gate } = useSettleGateStatus(vaultAddress, enabled);
  const { data: keeper } = useKeeperStatus(vaultAddress, enabled);
  const { data: queue } = useForwardQueue(vaultAddress, enabled);

  const hasQueue = Boolean(queue?.queueAddress);
  const isManager = Boolean(address && manager && address.toLowerCase() === manager.toLowerCase());

  const keeperGate = useCapabilities("regular").canForwardKeeper(manager);

  const heldTokens = (rebalance?.heldTokens ?? []).map((h) => h.token);
  const apFiller =
    (chainId in addresses ? addresses[chainId as keyof typeof addresses] : {})["MockAPFiller"] ?? "";

  const guards = gate?.guards ?? [];
  const passCount = guards.filter((g) => g.ok).length;
  const guardsBlocked = guards.length > 0 && passCount < guards.length;

  return (
    <div className="flex flex-col gap-4" data-workspace="operations">
      <div className="flex items-start gap-3 border border-amber/30 rounded-lg bg-gradient-to-r from-surface2 to-surface px-3.5 py-3">
        <div className="grid place-items-center w-8 h-8 rounded-md bg-amber/[0.12] text-amber shrink-0">⚙</div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Operations — Forward Operator workspace</h2>
          <p className="text-[11.5px] text-txt2 mt-0.5">
            Keepers (a.k.a. Forward Operators) do the housekeeping that keeps cash settlement honest — record TWAP
            price prints, run the settle checklist, settle past-cutoff tickets, manage escrow. Paid a small tip,
            never a cut of volume. Most holders never need this tab.
          </p>
        </div>
        <Aud role="keeper" className="shrink-0" />
      </div>

      {!keeperGate.enabled && <GateBanner gate={keeperGate} />}

      {hasQueue ? (
        <Module
          title="Settle-readiness checklist"
          icon={<IconChecklist />}
          audience="keeper"
          help="Every guard must PASS before any forward ticket can settle. Shown cryptically as g0…g8 in the contract — here they're plain English. One pending check blocks settlement."
          right={
            <Chip variant={guardsBlocked ? "pend" : "ok"}>
              {guards.length === 0 ? "—" : guardsBlocked ? `${passCount}/${guards.length} ready` : "All clear"}
            </Chip>
          }
          bodyClassName="p-0"
        >
          <SettleReadinessPanel gate={gate ?? null} />
        </Module>
      ) : (
        <Module
          title="Cash settlement"
          icon={<IconCoins />}
          audience="curator"
          help="Cash (forward-priced) create/redeem is an opt-in tool the index manager enables. In-kind create/redeem always works without it."
          bodyClassName="p-0"
        >
          {isManager ? (
            <EnableCashSettlementPanel vault={vaultAddress} manager={manager} />
          ) : (
            <p className="text-[11px] text-txt2 px-3 py-3">
              Cash settlement isn’t enabled for this index. Redeem in-kind anytime; the index manager can enable
              forward-priced cash flows.
            </p>
          )}
        </Module>
      )}

      {import.meta.env.VITE_DEMO_MODE === "true" && (
        <Module title="Price-safety (judge sandbox)" icon={<IconChecklist />} audience="curator" bodyClassName="p-0">
          <DemoPriceSafetyPanel vault={vaultAddress} />
        </Module>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Module
          title="Record price · settle"
          icon={<IconClock />}
          audience="keeper"
          help="TWAP = time-weighted average price. The keeper posts price observations; several recent prints are required (the prints guard) so settlement can't hinge on one bad tick. Settle prices the past-cutoff batch at the next open."
        >
          <ForwardKeeperPanel
            vaultAddress={vaultAddress}
            manager={manager}
            heldTokens={heldTokens}
            tickets={tickets ?? []}
            apFiller={apFiller}
            guardsBlocked={guardsBlocked}
          />
        </Module>

        <Module
          title="Keeper escrow & payouts"
          icon={<IconCoins />}
          audience="keeper"
          help="Keepers post a small escrow as anti-spam, and collect a fixed tip for recording prices and settling tickets. Zero protocol fee — never a percentage of volume."
        >
          {keeper ? (
            <KeeperPanel keeper={keeper} />
          ) : (
            <p className="text-[11.5px] text-txt2">No keeper data yet.</p>
          )}
        </Module>
      </div>
    </div>
  );
}
