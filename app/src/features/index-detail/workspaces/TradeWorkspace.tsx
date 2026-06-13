import { useState } from "react";
import { useAccount } from "wagmi";
import type { BasketDetail, HistoryQuery, NavResponse } from "@meridian/sdk";
import { Module } from "../../../components/Module";
import { DemoPriceSafetyPanel } from "../DemoPriceSafetyPanel";
import { Aud } from "../../../components/Aud";
import { IconChart, IconCheck, IconGrid, IconDownload, IconDollar } from "../../../components/icons";
import { Button } from "../../../components/Button";
import { Chip } from "../../../components/Chip";
import { EstBadge } from "../../../components/EstBadge";
import { GateBanner } from "../../../components/GateBanner";
import { IronRuleCallout } from "../../../components/IronRuleCallout";
import { KV } from "../../../components/KV";
import { PriceChart } from "../../../components/PriceChart";
import { cn } from "../../../lib/cn";
import { formatQty, formatUsd, formatSignedPctFromBps, shortenAddress } from "../../../lib/format";
import { useHistory } from "../../../data/useHistory";
import { useHoldings } from "../../../data/useHoldings";
import { useAccountHoldings } from "../../../data/useAccountHoldings";
import { useCapabilities } from "../../../capabilities/use-capabilities";
import { HoldingsTable } from "../HoldingsTable";

const RANGES: HistoryQuery["range"][] = ["1h", "1d", "1w"];

export function TradeWorkspace({
  vaultAddress,
  basket,
  nav,
  premium,
  onRedeem,
}: {
  vaultAddress: string;
  basket: BasketDetail;
  nav: NavResponse | null;
  premium?: { marketPrice: string; premiumBps: number } | null;
  onRedeem?: (method: "inkind" | "cash") => void;
}) {
  const [range, setRange] = useState<HistoryQuery["range"]>("1d");
  const { data: history } = useHistory(vaultAddress, range);

  const marketStatus = nav?.marketStatus ?? "unknown";
  const estimated = nav?.estimated ?? false;
  const caps = useCapabilities(marketStatus, vaultAddress);
  const cashGate = caps.canRedeemCash();
  // Cash redeem is a rebalance-only (forward-queue) capability; static types are in-kind only.
  const isRebalance = basket.vaultType === "rebalance";

  const { address, isConnected } = useAccount();
  const { data: holdingsData } = useHoldings(vaultAddress);
  const { data: accountHoldings } = useAccountHoldings(address);
  const position = accountHoldings?.holdings.find(
    (h) => h.vaultAddress.toLowerCase() === vaultAddress.toLowerCase(),
  );

  const series = history ?? [];

  return (
    <div className="flex flex-col gap-4" data-workspace="trade">
      <div className="flex items-start gap-3 border border-cyan/30 rounded-lg bg-gradient-to-r from-surface2 to-surface px-3.5 py-3">
        <div className="grid place-items-center w-8 h-8 rounded-md bg-cyan/[0.12] text-cyan shrink-0">📈</div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Trade — Holder workspace</h2>
          <p className="text-[11.5px] text-txt2 mt-0.5">
            Buy, sell and redeem {basket.symbol}. The everyday 95% case. Pick an action below, then size and submit in
            the Order Rail.
          </p>
        </div>
        <Aud role="holder" className="shrink-0" />
      </div>

      {import.meta.env.VITE_DEMO_MODE === "true" && (
        <Module title="Demo sandbox" icon={<span>🎚️</span>} audience="holder" bodyClassName="p-0">
          <DemoPriceSafetyPanel vault={vaultAddress} />
        </Module>
      )}

      <div className="grid grid-cols-[2fr_1fr] gap-3 items-stretch">
        <Module
          title="Price & NAV"
          icon={<IconChart />}
          help="What one unit is worth over time, the sum of the stocks it holds. The line is NAV — solid while the market is open, dashed (an estimate) when closed."
          right={
            <div className="inline-flex rounded-md border border-line bg-surface2 overflow-hidden">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={cn(
                    "px-2 py-0.5 text-[10px] border-r border-line last:border-r-0 font-mono uppercase",
                    range === r ? "bg-cyan text-[#06080a] font-semibold" : "text-txt2 hover:bg-surface3",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          }
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5 font-mono text-[10px] text-txt3">
            <span>NAV</span>
            {estimated && <span aria-hidden>≈</span>}
            <span className="text-txt2">{nav?.nav ? formatUsd(nav.nav) : "—"}</span>
            {estimated && <EstBadge />}
            {premium && (
              <>
                <span className="text-txt3/60">·</span>
                <span>DEX</span>
                <span className="text-txt2">{formatUsd(premium.marketPrice)}</span>
                <span className="text-txt3/60">·</span>
                <span className={premium.premiumBps >= 0 ? "text-emerald" : "text-red"}>
                  {formatSignedPctFromBps(premium.premiumBps)}
                </span>
              </>
            )}
          </div>
          <PriceChart data={series} estimated={estimated} sample={false} className="h-40" />
        </Module>

        <Module
          title="Your position"
          icon={<IconCheck />}
          audience="holder"
          help="What you hold of this index right now: your units and their value at the current NAV."
          right={isConnected ? <Chip variant="ok">connected</Chip> : undefined}
          className="h-full"
        >
          {isConnected ? (
            <>
              <KV
                label="Holding"
                value={position ? `${formatQty(position.balance)} ${basket.symbol}` : `0 ${basket.symbol}`}
              />
              <KV
                label="Market value"
                value={
                  position ? (
                    <span className="inline-flex items-center gap-1">
                      {position.estimated && <span aria-hidden className="text-txt2">≈</span>}
                      {formatUsd(position.valueUsd)}
                      {position.estimated && <EstBadge />}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <KV label="Cost basis" value={<span className="text-txt3">—</span>} />
              <KV label="Unrealized P/L" value={<span className="text-txt3">—</span>} />
              {address && <KV label="Wallet" value={shortenAddress(address)} />}
            </>
          ) : (
            <p className="text-[11.5px] text-txt2">Connect your wallet to see your position.</p>
          )}
        </Module>
      </div>

      <IronRuleCallout marketStatus={nav?.marketStatus ?? null} forward={isRebalance} />

      <Module
        title="What's inside one unit — Constituents"
        icon={<IconGrid />}
        help={
          isRebalance
            ? "Each unit is backed 1:1 by these tokenized stocks. Cur % is today's weight, Tgt % the target; the gap is the drift a rebalance fixes."
            : "Each unit is backed 1:1 by these tokenized stocks. Cur % is today's weight against the fixed target."
        }
        right={
          <Chip variant="neutral">
            {basket.constituents.length} holding{basket.constituents.length === 1 ? "" : "s"} · per 1 {basket.symbol}
          </Chip>
        }
        bodyClassName="p-0"
      >
        <HoldingsTable rows={holdingsData?.holdings ?? []} />
      </Module>

      <div className={cn("grid gap-3", isRebalance ? "grid-cols-2" : "grid-cols-1")}>
        <Module
          title="Redeem in-kind"
          icon={<IconDownload />}
          help="Burn your units and receive the actual underlying stock tokens. Needs no price, so it works 24/7 and is never paused — the core non-custodial guarantee."
          right={<Chip variant="ok">Always</Chip>}
          bodyClassName="flex flex-col"
        >
          <p className="flex-1 text-[11.5px] text-txt2">
            Burn {basket.symbol}, get the real stock tokens directly to your wallet. No oracle, no price, no
            waiting — works even when the market is closed.
          </p>
          <Button
            variant="primary"
            full
            className="mt-3"
            onClick={() => onRedeem?.("inkind")}
            aria-label="Redeem in-kind"
          >
            Redeem in-kind →
          </Button>
        </Module>

        {isRebalance && (
          <Module
            title="Redeem to cash (USDC)"
            icon={<IconDollar />}
            help="Pays USDC via the forward queue. While the market is open it settles now at NAV. While closed it becomes a forward ticket that settles at the next open's real price — never at the closed-market estimate (the Iron Rule)."
            right={<Chip variant={cashGate.enabled ? "ok" : "info"}>{cashGate.enabled ? "Settles now" : "Forward"}</Chip>}
            bodyClassName="flex flex-col"
          >
            <div className="flex-1">
              <p className="text-[11.5px] text-txt2">
                {cashGate.enabled
                  ? "Receive USDC. Market is open, so this settles immediately at NAV."
                  : "Market is closed → becomes a forward ticket that settles at the next open's real price."}
              </p>
              {!cashGate.enabled && <GateBanner gate={cashGate} className="mt-2" />}
            </div>
            <Button full className="mt-3" onClick={() => onRedeem?.("cash")} aria-label="Redeem to cash">
              Redeem to cash →
            </Button>
          </Module>
        )}
      </div>
    </div>
  );
}
