import type { MarketStatus } from "@meridian/sdk";

// `forward` toggles the cash/forward-ticket line, which only applies to vaults with a forward
// queue (rebalance). For static types the callout keeps just the in-kind / estimate guarantee.
export function IronRuleCallout({
  marketStatus,
  forward = true,
}: {
  marketStatus: MarketStatus | null;
  forward?: boolean;
}) {
  if (marketStatus === "regular") return null;
  return (
    <div className="border border-amber/30 rounded-lg bg-amber/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-amber/30 bg-amber/[0.07]">
        <span>⚑</span>
        <span className="text-[11.5px] font-bold text-amber tracking-wide">
          Iron rule — a closed-market NAV is an estimate, never a settlement price
        </span>
      </div>
      <div className="px-3 py-3 text-[11.5px] text-txt2 leading-relaxed">
        <b className="text-txt">In-kind redeem</b> needs no price → still works 24/7, never paused.
        {forward && (
          <>
            <br />
            <b className="text-txt">Cash in / out</b> → becomes a forward ticket, settling at the next market open's real
            price — not the estimate.
          </>
        )}
      </div>
    </div>
  );
}
