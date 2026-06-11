import type { BasketDetail, RebalanceDetail } from "@meridian/sdk";
import { Module } from "../../../components/Module";
import { Aud } from "../../../components/Aud";
import { IconGauge, IconEdit, IconSwap, IconHistory } from "../../../components/icons";
import { GateBanner } from "../../../components/GateBanner";
import { useCapabilities } from "../../../capabilities/use-capabilities";
import { useRebalanceHistory } from "../../../data/useRebalanceHistory";
import { shortenAddress } from "../../../lib/format";
import { DriftBadge } from "../DriftBadge";
import { HoldingsVsTarget } from "../HoldingsVsTarget";
import { RebalancePanel } from "../RebalancePanel";
import { AuctionPanel } from "../AuctionPanel";
import { RebalanceHistory } from "../RebalanceHistory";

export function ManageWorkspace({
  vaultAddress,
  basket,
  rebalance,
}: {
  vaultAddress: string;
  basket: BasketDetail;
  rebalance: RebalanceDetail | null;
}) {
  const enabled = basket.vaultType === "rebalance";
  const manager = basket.manager ?? "";

  const curateGate = useCapabilities("regular").canCurate(manager);
  const { data: history } = useRebalanceHistory(vaultAddress, enabled);

  const drift = rebalance?.drift ?? null;
  const bandPct = drift ? (drift.triggerBandBps / 100).toFixed(2) : null;
  const maxDriftBps = drift
    ? drift.items.reduce((m, i) => (Math.abs(i.driftBps) > Math.abs(m) ? i.driftBps : m), 0)
    : 0;
  const maxDriftPct = (maxDriftBps / 100).toFixed(2);
  const sign = maxDriftBps > 0 ? "+" : "";

  return (
    <div className="flex flex-col gap-4" data-workspace="manage">
      <div className="flex items-start gap-3 border border-emerald/30 rounded-lg bg-gradient-to-r from-surface2 to-surface px-3.5 py-3">
        <div className="grid place-items-center w-8 h-8 rounded-md bg-emerald/[0.12] text-emerald shrink-0">🛠</div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Manage — Curator / Manager workspace</h2>
          <p className="text-[11.5px] text-txt2 mt-0.5">
            The fund manager schedules target weights (with a timelock), opens a Dutch auction to rebalance, and
            reviews drift and history. Read-only for everyone else — holders never need this tab.
          </p>
        </div>
        <Aud role="curator" className="shrink-0" />
      </div>

      {!curateGate.enabled && <GateBanner gate={curateGate} />}

      <div className="grid grid-cols-2 gap-3">
        <Module
          title="Drift & rebalance status"
          icon={<IconGauge />}
          audience="curator"
          help="Drift = how far live weights are from target. When max drift exceeds the band, a rebalance is due. The auction below brings the basket back in line."
          right={drift ? <DriftBadge drift={drift} /> : undefined}
        >
          <div className="flex flex-col gap-1.5 mb-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-txt3">Max drift</span>
              <span className={drift?.isDue ? "text-amber font-mono tabular-nums" : "text-txt font-mono tabular-nums"}>
                {drift ? `${sign}${maxDriftPct}%` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-txt3">Drift band</span>
              <span className="text-txt font-mono tabular-nums">{bandPct ? `±${bandPct}%` : "—"}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-txt3">Verdict</span>
              <span className={drift?.isDue ? "text-amber" : "text-txt2"}>
                {drift ? (drift.isDue ? "over band → rebalance due" : "within band") : "no drift data"}
              </span>
            </div>
          </div>
          {rebalance && <HoldingsVsTarget detail={rebalance} />}
        </Module>

        <Module
          title="Schedule target weights"
          icon={<IconEdit />}
          audience="curator"
          help="Weight changes go through a timelock: proposed now, active after a delay, so holders can see and exit before it takes effect."
        >
          <RebalancePanel
            vaultAddress={vaultAddress}
            manager={manager}
            detail={
              rebalance ?? {
                vaultAddress,
                heldTokens: [],
                target: [],
                pendingTarget: null,
                lastRebalanceAtMs: null,
                drift: null,
              }
            }
          />
          {manager && (
            <p className="text-[10.5px] text-txt3 mt-2 font-mono">Manager {shortenAddress(manager)}</p>
          )}
        </Module>
      </div>

      <Module
        title="Rebalance auction"
        icon={<IconSwap />}
        audience="curator"
        help="A Dutch auction swaps tokens against the vault to rebalance: the manager opens it, arbitrageurs bid. Value-preserving and constituent-bounded — the vault enforces the limits, not the auction."
      >
        <AuctionPanel vaultAddress={vaultAddress} manager={manager} />
      </Module>

      <Module
        title="Rebalance history"
        icon={<IconHistory />}
        audience="curator"
        help="Past rebalances and weight changes — the on-chain record of how the basket has been managed."
      >
        <RebalanceHistory history={history ?? { items: [] }} />
      </Module>
    </div>
  );
}
