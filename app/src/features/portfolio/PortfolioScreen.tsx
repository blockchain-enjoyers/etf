import { formatUnits } from "viem";
import type { AccountHolding, ForwardTicket } from "@meridian/sdk";
import { EstBadge } from "../../components/EstBadge";
import { EmptyState } from "../../components/EmptyState";
import { Chip } from "../../components/Chip";
import { formatQty, formatUsd } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { useAccountHoldings } from "../../data/useAccountHoldings";

interface Props {
  holdings?: AccountHolding[];
  queueTickets?: ForwardTicket[];
}

function ticketSettles(cutoffMs: number): string {
  return cutoffMs <= Date.now() ? "at next open" : new Date(cutoffMs).toLocaleString();
}

function totalValueUsd(holdings: AccountHolding[]): string {
  return holdings.reduce((acc, h) => acc + BigInt(h.valueUsd), 0n).toString();
}

function isEstimated(holdings: AccountHolding[]): boolean {
  return holdings.some((h) => h.estimated);
}

const SEC_CLASS = "text-[9px] uppercase tracking-[0.1em] text-txt3 font-semibold mb-2";
const TH_CLASS =
  "text-left text-txt3 font-semibold text-[9px] uppercase tracking-[0.1em] px-2.5 py-1.5 border-b border-line whitespace-nowrap";
const TD_CLASS = "px-2.5 py-2 border-b border-line-soft font-mono tabular-nums";

function PortfolioHeader() {
  return (
    <header className="flex items-center gap-3 border-b border-line bg-bg2 px-[18px] py-2.5 shrink-0">
      <h2 className="text-sm font-semibold tracking-wide text-txt">Portfolio</h2>
      <span className="font-mono text-[10px] uppercase tracking-widest text-txt3">
        positions · forward queue
      </span>
    </header>
  );
}

function Stat({
  testId,
  value,
  label,
}: {
  testId: string;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div
      data-testid={testId}
      className="border border-line rounded-lg bg-surface p-3 flex-1 flex flex-col gap-0.5"
    >
      <div className="text-[9.5px] uppercase tracking-wider text-txt3">{label}</div>
      <div className="font-mono text-[20px] font-semibold leading-none tabular-nums text-txt flex items-center gap-1.5">
        {value}
      </div>
    </div>
  );
}

export function PortfolioScreen({ holdings = [], queueTickets = [] }: Props) {
  const hasAny = holdings.length > 0 || queueTickets.length > 0;
  const estimated = isEstimated(holdings);
  const positions = holdings.length;
  const pending = queueTickets.length;
  const total = totalValueUsd(holdings);

  if (!hasAny) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <PortfolioHeader />
        <div className="p-[18px]">
          <EmptyState message="No positions yet" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PortfolioHeader />
      <div className="p-[18px] flex flex-col gap-4 overflow-y-auto">
        <div className="flex gap-4">
          <Stat
            testId="stat-total"
            value={
              <>
                {estimated && <span aria-hidden="true">≈</span>}
                {formatUsd(total)}
                {estimated && <EstBadge />}
              </>
            }
            label="Total value"
          />
          <Stat testId="stat-positions" value={positions} label="Positions" />
          <Stat testId="stat-pending" value={pending} label="In queue" />
        </div>

        {holdings.length > 0 && (
          <div>
            <div className={SEC_CLASS}>Holdings</div>
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Index</th>
                  <th className={TH_CLASS}>Units</th>
                  <th className={TH_CLASS}>{estimated ? "~Value" : "Value"}</th>
                  <th className={TH_CLASS} />
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.vaultAddress} className="hover:bg-surface2 transition-colors">
                    <td className={TD_CLASS}>
                      <span className="font-bold text-txt">{h.symbol}</span>
                    </td>
                    <td className={cn(TD_CLASS, "text-right")}>{formatQty(h.balance)}</td>
                    <td className={cn(TD_CLASS, "text-right")}>
                      <span
                        className={cn("inline-flex items-center gap-1", h.estimated && "text-txt2")}
                      >
                        {h.estimated && "≈"}
                        {formatUsd(h.valueUsd)}
                        {h.estimated && <EstBadge />}
                      </span>
                    </td>
                    <td className={cn(TD_CLASS, "text-txt3 text-[10px] text-right")}>
                      <Link to={`/index/${h.vaultAddress}`} className="hover:text-cyan">
                        Create · Redeem ▸
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {queueTickets.length > 0 && (
          <div>
            <div className={SEC_CLASS}>Pending (forward queue)</div>
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr>
                  <th className={TH_CLASS}>Ticket</th>
                  <th className={TH_CLASS}>Type</th>
                  <th className={TH_CLASS}>Remaining</th>
                  <th className={TH_CLASS}>Settles</th>
                  <th className={TH_CLASS}>Price basis</th>
                  <th className={TH_CLASS} />
                </tr>
              </thead>
              <tbody>
                {queueTickets.map((t) => (
                  <tr key={`${t.vaultAddress}-${t.id}`} className="hover:bg-surface2 transition-colors">
                    <td className={cn(TD_CLASS, "font-bold text-txt")}>#{t.id}</td>
                    <td className={TD_CLASS}>{t.kind === "create" ? "Cash create" : "Cash redeem"}</td>
                    <td className={TD_CLASS}>
                      {formatUnits(BigInt(t.remainingRaw), t.kind === "create" ? 6 : 18)}
                    </td>
                    <td className={TD_CLASS}>{ticketSettles(t.cutoffMs)}</td>
                    <td className={TD_CLASS}>
                      <Chip variant="pend">open (authoritative)</Chip>
                    </td>
                    <td className={cn(TD_CLASS, "text-txt3 text-[10px] text-right")}>
                      <Link to={`/index/${t.vaultAddress}`} className="hover:text-cyan">
                        Track · Cancel ▸
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function PortfolioRoute() {
  const { address } = useAccount();
  const { data: acct } = useAccountHoldings(address);
  const rawHoldings = acct?.holdings ?? [];
  // Forward tickets are per-vault (api.getForwardTickets) and account holdings carry no vaultType,
  // so there is no account-level source yet — the queue section stays hidden rather than show fakes.
  return <PortfolioScreen holdings={rawHoldings} queueTickets={[]} />;
}
