import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { useStatusView } from "../../status/StatusViewContext";
import { useBasket } from "../../data/useBasket";
import { useNav } from "../../data/useNav";
import { usePremiumDiscount } from "../../data/usePremiumDiscount";
import { useRebalanceDetail } from "../../data/useRebalanceDetail";
import { InstrumentBar, type InstrumentStat } from "../../components/InstrumentBar";
import { HelpTip } from "../../components/HelpTip";
import { WorkspaceTabs, type WorkspaceId, type WorkspaceTab } from "../../components/WorkspaceTabs";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatQty, formatUsd, formatSignedPctFromBps } from "../../lib/format";
import { useAccountHoldings } from "../../data/useAccountHoldings";
import { TradeWorkspace } from "./workspaces/TradeWorkspace";
import { LiquidityWorkspace } from "./workspaces/LiquidityWorkspace";
import { OperationsWorkspace } from "./workspaces/OperationsWorkspace";
import { ManageWorkspace } from "./workspaces/ManageWorkspace";
import { OrderRail, type Direction, type RedeemMethod } from "./OrderRail";

const TABS: WorkspaceTab[] = [
  { id: "trade", label: "Trade", who: "Buy · Sell · Redeem", role: "holder", icon: "📈" },
  { id: "liquidity", label: "Liquidity", who: "Forward create / redeem · tickets", role: "ap", icon: "💧" },
  { id: "operations", label: "Operations", who: "Settle · record price · payouts", role: "keeper", icon: "⚙" },
  { id: "manage", label: "Manage", who: "Target weights · auction · drift", role: "curator", icon: "🛠" },
];

const VAULT_TYPE_LABEL: Record<string, string> = {
  basket: "Static",
  managed: "Managed",
  committed: "Committed",
  rebalance: "Rebalance",
};

// Fee bps → unsigned percent, e.g. 50 → "0.50%". Null/absent fees render as "—".
function formatBps(bps?: number | null): string {
  if (bps == null) return "—";
  return `${(bps / 100).toFixed(2)}%`;
}

export function IndexDetailScreen() {
  const { vaultAddress } = useParams<{ vaultAddress: string }>();
  const [active, setActive] = useState<WorkspaceId>("trade");
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // Order-rail direction/method lifted here so the Trade redeem cards can drive the rail.
  const [orderDir, setOrderDir] = useState<Direction>("mint");
  const [redeemMethod, setRedeemMethod] = useState<RedeemMethod>("inkind");

  const { data: basket, isLoading, error } = useBasket(vaultAddress ?? "");
  // nav may legitimately 404 (fresh basket, no price feed) — never block render on it.
  const { data: nav } = useNav(vaultAddress ?? "");
  const { data: premium } = usePremiumDiscount(vaultAddress ?? "");
  const isRebalance = basket?.vaultType === "rebalance";
  const { data: rebalance } = useRebalanceDetail(vaultAddress ?? "", Boolean(isRebalance));
  const { address } = useAccount();
  const { data: acct } = useAccountHoldings(address);
  const myBalance =
    acct?.holdings.find(
      (h) => h.vaultAddress.toLowerCase() === (vaultAddress ?? "").toLowerCase(),
    )?.balance ?? "0";

  // Liquidity/Operations/Manage are rebalance-only (forward queue, keeper, curator). Static
  // vault types (basket/managed/committed) expose only Trade.
  const tabs = isRebalance ? TABS : TABS.filter((t) => t.id === "trade");

  // A stale active tab (e.g. "manage" carried from a rebalance vault) must never persist on a
  // static vault — fall back to Trade whenever the active tab isn't in the visible set.
  useEffect(() => {
    if (!tabs.some((t) => t.id === active)) setActive("trade");
  }, [tabs, active]);

  const { setView } = useStatusView();
  const activeLabel = TABS.find((t) => t.id === active)?.label ?? "Trade";
  useEffect(() => {
    setView(`Index · ${activeLabel}`);
    return () => setView(null);
  }, [activeLabel, setView]);

  if (!vaultAddress) return <ErrorState message="No vault address provided." />;
  if (error) return <ErrorState message="Failed to load basket." />;
  if (isLoading || !basket) return <Skeleton className="h-full" />;

  const typeLabel = VAULT_TYPE_LABEL[basket.vaultType ?? "basket"] ?? "Static";

  // Signed max-abs drift across constituents: the worst gap vs target the rebalance fixes.
  const maxDriftBps = rebalance?.drift?.items.reduce(
    (max, it) => (Math.abs(it.driftBps) > Math.abs(max) ? it.driftBps : max),
    0,
  );

  const stats: InstrumentStat[] = [
    {
      k: "Your holding",
      v: `${formatQty(myBalance)} ${basket.symbol}`,
    },
    {
      k: (
        <>
          Market (DEX){" "}
          <HelpTip>
            The price {basket.symbol} currently trades at on the DEX. Can drift above/below NAV — that gap is the
            premium / discount.
          </HelpTip>
        </>
      ),
      v: premium != null ? formatUsd(premium.marketPrice) : "—",
    },
    {
      k: "Premium",
      v: premium != null ? formatSignedPctFromBps(premium.premiumBps) : "—",
    },
  ];

  if (isRebalance && maxDriftBps != null) {
    stats.push({
      k: (
        <>
          Drift max{" "}
          <HelpTip>
            Drift = how far current weights are from target. When max drift exceeds the band, a rebalance is due.
          </HelpTip>
        </>
      ),
      v: formatSignedPctFromBps(maxDriftBps),
    });
  }

  stats.push({
    k: "Mgr / Keeper fee",
    v: `${formatBps(basket.managerFeeBps)} / ${formatBps(basket.keeperBps)}`,
  });

  // Onboarding hint is novice guidance shown only on the default Trade workspace. It points at the
  // role tabs, so it's irrelevant when only Trade exists (static vault types).
  const showOnboarding = active === "trade" && !onboardingDismissed && isRebalance;
  const notRebalance = (
    <div className="border border-line rounded-lg bg-surface p-6 text-center text-txt2 text-xs">
      Not available for this vault type — this is a {typeLabel} index.
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <InstrumentBar
        symbol={basket.symbol}
        name={basket.name}
        navLabel={nav?.nav ? formatUsd(nav.nav) : "—"}
        typeLabel={typeLabel}
        marketStatus={nav?.marketStatus ?? null}
        estimated={nav?.estimated ?? false}
        stats={stats}
      />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col gap-4">
          <WorkspaceTabs tabs={tabs} active={active} onChange={setActive} />
          {isRebalance && (
            <p className="flex items-center gap-1.5 -mt-1 px-0.5 text-[10.5px] text-txt3">
              <span aria-hidden>ⓘ</span>
              One workspace shows at a time — click a tab to switch. You start on Trade.
            </p>
          )}
          {showOnboarding && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-cyan-dim bg-gradient-to-r from-cyan/[0.07] to-cyan/[0.01] text-[11.5px] text-txt2">
              <span aria-hidden className="grid place-items-center w-6 h-6 rounded-md bg-cyan/[0.12] text-cyan shrink-0">ⓘ</span>
              <p className="flex-1">
                <b className="text-cyan font-semibold">New here? Stay on Trade.</b> Only open Liquidity, Operations or Manage
                if you&apos;re an AP, an operator, or the manager.
              </p>
              <button
                type="button"
                onClick={() => setOnboardingDismissed(true)}
                aria-label="Dismiss hint"
                className="shrink-0 px-1 font-mono text-sm text-txt3 hover:text-txt"
              >
                ✕
              </button>
            </div>
          )}
          {active === "trade" && (
            <TradeWorkspace
              vaultAddress={vaultAddress}
              basket={basket}
              nav={nav ?? null}
              premium={premium ?? null}
              onRedeem={(m) => {
                setRedeemMethod(m);
                setOrderDir("redeem");
              }}
            />
          )}
          {active === "liquidity" && (isRebalance ? <LiquidityWorkspace vaultAddress={vaultAddress} basket={basket} /> : notRebalance)}
          {active === "operations" && (isRebalance ? <OperationsWorkspace vaultAddress={vaultAddress} basket={basket} /> : notRebalance)}
          {active === "manage" && (isRebalance ? <ManageWorkspace vaultAddress={vaultAddress} basket={basket} rebalance={rebalance ?? null} /> : notRebalance)}
        </div>
        {active === "trade" && (
          <OrderRail
            vaultAddress={vaultAddress}
            basket={basket}
            nav={nav ?? null}
            rebalance={rebalance ?? null}
            direction={orderDir}
            onDirectionChange={setOrderDir}
            redeemMethod={redeemMethod}
            onRedeemMethodChange={setRedeemMethod}
          />
        )}
      </div>
    </div>
  );
}
