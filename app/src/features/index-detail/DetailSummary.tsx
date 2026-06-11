import type { BasketDetail, NavResponse, PremiumDiscount } from "@meridian/sdk";
import { Dot } from "../../components/Dot";
import { EstBadge } from "../../components/EstBadge";
import { ConfidenceBand } from "../../components/ConfidenceBand";
import { formatUsd, formatSignedPctFromBps, shortenAddress } from "../../lib/format";

interface Props {
  basket: BasketDetail;
  nav: NavResponse | null;
  premium: PremiumDiscount | null;
}

type DotVariant = "open" | "closed" | "halt";

function marketDotVariant(status: NavResponse["marketStatus"]): DotVariant {
  if (status === "regular" || status === "preMarket" || status === "postMarket") return "open";
  if (status === "unknown") return "halt";
  return "closed";
}

function marketLabel(variant: DotVariant): string {
  if (variant === "open") return "OPEN";
  if (variant === "halt") return "HALT";
  return "CLOSED";
}

function confidenceBandWidthPct(lower: string, upper: string, nav: string, estimated: boolean): number {
  const navNum = parseFloat(nav);
  if (navNum === 0) return 0;
  const spread = parseFloat(upper) - parseFloat(lower);
  const pct = (spread / navNum) * 100;
  return estimated ? Math.min(pct * 2, 100) : Math.min(pct, 100);
}

function Metric({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[18px] font-semibold text-txt leading-tight">{value}</span>
      <span className="text-[11px] text-txt2">{label}</span>
    </div>
  );
}

export function DetailSummary({ basket, nav, premium }: Props) {
  // No NAV (fresh basket / no feed): show "—", halt dot, no band/est/banner.
  const dotVariant = nav ? marketDotVariant(nav.marketStatus) : "halt";
  const estimated = nav?.estimated ?? false;

  const bandPct = nav
    ? confidenceBandWidthPct(nav.confidenceLower, nav.confidenceUpper, nav.nav, estimated)
    : 0;

  const bandLabel = nav
    ? `NAV · band ${formatUsd(nav.confidenceLower)}–${formatUsd(nav.confidenceUpper)}${
        estimated ? " (wide)" : ""
      }`
    : "no NAV yet";

  return (
    <div className="flex items-center gap-[22px] flex-wrap px-[18px] py-3 border-b border-line">
      <Metric
        value={
          <span className="inline-flex items-baseline gap-1.5">
            <span>{basket.symbol}</span>
            <span className="text-txt2 font-normal">·</span>
            <span>{basket.name}</span>
          </span>
        }
        label={`Index · ${basket.constituents.length} constituents`}
      />

      <Metric
        value={
          <span className="inline-flex items-center gap-1.5">
            {estimated && <span aria-hidden="true">≈</span>}
            {nav ? formatUsd(nav.nav) : "—"}
            {estimated && <EstBadge />}
          </span>
        }
        label={
          nav ? (
            <span className="inline-flex flex-col gap-1">
              <span>{bandLabel}</span>
              <ConfidenceBand widthPct={bandPct} className="w-32" />
            </span>
          ) : (
            <span className="text-txt2">{bandLabel}</span>
          )
        }
      />

      <Metric
        value={
          <span className="inline-flex items-center gap-1.5">
            <Dot variant={dotVariant} />
            {marketLabel(dotVariant)}
          </span>
        }
        label={nav ? (estimated ? "NAV est" : "live") : "no NAV"}
      />

      {premium && (
        <Metric
          value={formatSignedPctFromBps(premium.premiumBps)}
          label={`premium · mkt ${formatUsd(premium.marketPrice)}`}
        />
      )}

      {basket.vaultType === "managed" && basket.manager && (
        <Metric value={shortenAddress(basket.manager)} label="Manager" />
      )}

      {basket.vaultType === "managed" && (
        <Metric value={`${(basket.managerFeeBps ?? 0) / 100}%`} label="Mgmt fee" />
      )}

      <div className="flex-1" />

      {nav && estimated && nav.marketStatus === "unknown" && (
        <div
          role="alert"
          className="max-w-[340px] border border-amber/30 border-l-[3px] border-l-amber rounded-md bg-amber/[0.06] px-3 py-2 text-xs text-txt"
        >
          Market status unknown — estimate, not a settlement price. Cash in/out settles at next
          market open.
        </div>
      )}
      {nav && estimated && nav.marketStatus !== "unknown" && (
        <div
          role="alert"
          className="max-w-[340px] border border-amber/30 border-l-[3px] border-l-amber rounded-md bg-amber/[0.06] px-3 py-2 text-xs text-txt"
        >
          Estimate, not a settlement price. Cash in/out settles at next market open.
        </div>
      )}

    </div>
  );
}
