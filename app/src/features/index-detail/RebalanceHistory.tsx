import type { RebalanceHistory as RebalanceHistoryType } from "@meridian/sdk";
import { shortenAddress, formatQty, timeAgo } from "../../lib/format";

interface Props {
  history: RebalanceHistoryType;
}

const EXPLORER = "https://explorer.testnet.chain.robinhood.com/tx";

export function RebalanceHistory({ history }: Props) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-txt3 mb-2">Rebalance history</div>

      {history.items.length === 0 ? (
        <p className="text-[12px] text-txt2">No rebalances yet</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {history.items.map((item) => (
            <div
              key={item.txHash}
              className="border border-line-soft rounded-md px-3 py-2 text-[12px] bg-surface2"
            >
              <div className="flex items-center justify-between mb-1.5">
                <a
                  href={`${EXPLORER}/${item.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-cyan hover:underline"
                >
                  {shortenAddress(item.txHash)}
                </a>
                <span className="text-[11px] text-txt3">{timeAgo(item.timestampMs)}</span>
              </div>

              <div className="flex gap-4 text-xs">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-txt3">Acquire</span>
                  {item.acquire.length === 0 ? (
                    <div className="text-txt3 font-mono">—</div>
                  ) : (
                    item.acquire.map((leg) => (
                      <div key={leg.token} className="font-mono text-txt tabular-nums">
                        {formatQty(leg.amount)} <span className="text-txt2">{shortenAddress(leg.token)}</span>
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-txt3">Release</span>
                  {item.release.length === 0 ? (
                    <div className="text-txt3 font-mono">—</div>
                  ) : (
                    item.release.map((leg) => (
                      <div key={leg.token} className="font-mono text-txt tabular-nums">
                        {formatQty(leg.amount)} <span className="text-txt2">{shortenAddress(leg.token)}</span>
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-txt3">Recipient</span>
                  <div className="font-mono text-txt2">{shortenAddress(item.recipient)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
