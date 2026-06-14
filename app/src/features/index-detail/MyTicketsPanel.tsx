import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { ForwardTicket } from "@meridian/sdk";
import { Button } from "../../components/Button";
import { Chip, type ChipVariant } from "../../components/Chip";
import { queryKeys } from "../../lib/query";
import { useApi } from "../../lib/api";
import { useCapabilities } from "../../capabilities/use-capabilities";
import { useForwardQueue } from "../../data/useForwardQueue";
import { useTxPlan } from "../../wallet/use-tx-plan";

interface Props {
  vaultAddress: string;
  tickets: ForwardTicket[];
}

// Create amounts are the cash leg (decimals vary: USDG 18, MockUSDC 6); redeem amounts are shares (18).
function formatAmount(raw: string, kind: ForwardTicket["kind"], cashDecimals: number): string {
  return formatUnits(BigInt(raw), kind === "create" ? cashDecimals : 18);
}

function countdown(cutoffMs: number): string {
  const ms = cutoffMs - Date.now();
  if (ms <= 0) return "past cutoff";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}h ${m}m left`;
}

const STATUS_CHIP: Record<ForwardTicket["status"], ChipVariant> = {
  pending: "pend",
  partial: "pend",
  settled: "ok",
  cancelled: "neutral",
};

const TH = "text-left text-txt3 font-semibold text-[9px] uppercase tracking-wider px-2.5 py-1.5 border-b border-line whitespace-nowrap";
const TD = "px-2.5 py-2 border-b border-line-soft text-[11px] font-mono whitespace-nowrap";

export function MyTicketsPanel({ vaultAddress, tickets }: Props) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const cap = useCapabilities("regular").canForwardCancel();
  // Cancel's cancel(ticketId) targets the per-vault ForwardCashQueue clone (not in the static address
  // book) — seed it into the allowlist. Also drives the cash-leg decimals for amount formatting.
  const { data: queue } = useForwardQueue(vaultAddress, true);
  const cashDecimals = queue?.cashDecimals ?? 18;
  const tx = useTxPlan(queue?.queueAddress ? [queue.queueAddress] : []);
  const running = tx.status === "running";

  function handleCancel(ticketId: number) {
    void tx
      .run(() => api.buildForwardCancelTx(vaultAddress, { ticketId, account: address! }))
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.forwardTickets(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.forwardQueue(vaultAddress) });
      });
  }

  return (
    <div>
      {tickets.length === 0 ? (
        <p className="text-[11.5px] text-txt2">No forward tickets yet — queued cash flows will appear here.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Id", "Kind", "Remaining", "Status", "Cutoff", ""].map((h) => (
                <th key={h} className={TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => {
              const cancelable =
                cap.enabled && !running && (t.status === "pending" || t.status === "partial") && Date.now() < t.cutoffMs;
              return (
                <tr key={t.id} className="hover:bg-surface2">
                  <td className={`${TD} text-violet font-semibold`}>#{t.id}</td>
                  <td className={TD}>{t.kind}</td>
                  <td className={`${TD} text-txt2`}>
                    {formatAmount(t.remainingRaw, t.kind, t.cashDecimals ?? cashDecimals)} /{" "}
                    {formatAmount(t.amountRaw, t.kind, t.cashDecimals ?? cashDecimals)}
                  </td>
                  <td className={TD}>
                    <Chip variant={STATUS_CHIP[t.status]}>{t.status}</Chip>
                  </td>
                  <td className={`${TD} text-txt2`}>{countdown(t.cutoffMs)}</td>
                  <td className={TD}>
                    <Button
                      onClick={() => handleCancel(t.id)}
                      disabled={!cancelable}
                      className="text-[11px]"
                      aria-label={`Cancel ticket ${t.id}`}
                    >
                      Cancel
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {(tx.status === "success" || tx.error) && (
        <div className="mt-2 flex flex-col gap-1 text-xs" aria-label="transaction status">
          {tx.status === "success" && <span className="text-emerald">Confirmed ✓</span>}
          {tx.error && <span className="text-red">Failed: {tx.error}</span>}
        </div>
      )}
    </div>
  );
}
