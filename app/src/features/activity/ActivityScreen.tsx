import { formatUnits } from "viem";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import type { ActivityEvent } from "@meridian/sdk";
import { EmptyState } from "../../components/EmptyState";
import { Chip, type ChipVariant } from "../../components/Chip";
import { formatQty, shortenAddress } from "../../lib/format";
import { cn } from "../../lib/cn";
import { useActivity } from "../../data/useActivity";

const KIND_META: Record<ActivityEvent["kind"], { label: string; variant: ChipVariant }> = {
  mint: { label: "Mint", variant: "info" },
  redeem: { label: "Redeem", variant: "violet" },
  "forward-create": { label: "Cash create", variant: "pend" },
  "forward-redeem": { label: "Cash redeem", variant: "pend" },
  "forward-fill": { label: "Partial fill", variant: "pend" },
  "forward-settle": { label: "Settled", variant: "ok" },
  "forward-cancel": { label: "Cancelled", variant: "bad" },
};

/** Amounts are raw base units in the payload; format per kind (cash legs are 6-dec USDC, the rest 18-dec). */
function amountLabel(e: ActivityEvent): string {
  const p = e.payload;
  switch (e.kind) {
    case "mint":
      return p.minted ? `+${formatQty(p.minted)} ${e.symbol}` : "—";
    case "redeem":
      return p.amount ? `−${formatQty(p.amount)} ${e.symbol}` : "—";
    case "forward-create":
      return p.amount ? `${formatUnits(BigInt(p.amount), 6)} USDC` : "—";
    case "forward-redeem":
      return p.amount ? `${formatQty(p.amount)} ${e.symbol}` : "—";
    case "forward-fill":
      return p.filledCash ? `${formatUnits(BigInt(p.filledCash), 6)} USDC` : "—";
    default:
      return "—";
  }
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TH ="text-left text-txt3 font-semibold text-[9px] uppercase tracking-[0.1em] px-2.5 py-1.5 border-b border-line whitespace-nowrap";
const TD = "px-2.5 py-2 border-b border-line-soft font-mono tabular-nums";

function ActivityHeader() {
  return (
    <header className="flex items-center gap-3 border-b border-line bg-bg2 px-[18px] py-2.5 shrink-0">
      <h2 className="text-sm font-semibold tracking-wide text-txt">Activity</h2>
      <span className="font-mono text-[10px] uppercase tracking-widest text-txt3">
        fills · settlements · events
      </span>
    </header>
  );
}

export function ActivityScreen({
  events = [],
  connected = false,
}: {
  events?: ActivityEvent[];
  connected?: boolean;
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ActivityHeader />
      <div className="p-[18px] flex-1 min-h-0 overflow-y-auto">
        {!connected ? (
          <EmptyState message="Connect a wallet to see your activity" />
        ) : events.length === 0 ? (
          <EmptyState message="No activity yet" />
        ) : (
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr>
                <th className={TH}>Time</th>
                <th className={TH}>Action</th>
                <th className={TH}>Index</th>
                <th className={cn(TH, "text-right")}>Amount</th>
                <th className={TH}>Tx</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => {
                const meta = KIND_META[e.kind];
                return (
                  <tr key={`${e.txHash}-${i}`} className="hover:bg-surface2 transition-colors">
                    <td className={cn(TD, "text-txt3 text-[10px] whitespace-nowrap")}>
                      {fmtTime(e.timestampMs)}
                    </td>
                    <td className={TD}>
                      <Chip variant={meta.variant}>{meta.label}</Chip>
                    </td>
                    <td className={TD}>
                      <Link
                        to={`/index/${e.vaultAddress}`}
                        className="font-bold text-txt hover:text-cyan"
                      >
                        {e.symbol || "—"}
                      </Link>
                    </td>
                    <td className={cn(TD, "text-right")}>{amountLabel(e)}</td>
                    <td className={cn(TD, "text-txt3 text-[10px]")}>{shortenAddress(e.txHash)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function ActivityRoute() {
  const { address } = useAccount();
  const { data } = useActivity(address);
  return <ActivityScreen events={data ?? []} connected={Boolean(address)} />;
}
