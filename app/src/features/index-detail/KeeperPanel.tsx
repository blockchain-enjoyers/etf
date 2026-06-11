import type { KeeperStatus } from "@meridian/sdk";
import { shortenAddress, formatQty, timeAgo } from "../../lib/format";

interface Props {
  keeper: KeeperStatus;
}

const EXPLORER = "https://explorer.testnet.chain.robinhood.com/tx";

export function KeeperPanel({ keeper }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-6 text-xs">
        <div>
          <span className="text-txt3 text-[10px] uppercase tracking-wide">Escrow</span>
          <div className="font-mono tabular-nums text-txt">{formatQty(keeper.escrow)} shares</div>
        </div>
        <div>
          <span className="text-txt3 text-[10px] uppercase tracking-wide">Keeper cut</span>
          <div className="font-mono tabular-nums text-emerald">{keeper.keeperBps} bps</div>
        </div>
      </div>

      {keeper.payouts.length === 0 ? (
        <p className="text-[11.5px] text-txt2">No keeper payouts yet</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {["To", "Amount", "Tx", "When"].map((h) => (
                <th
                  key={h}
                  className="text-left text-txt3 font-semibold text-[10px] uppercase tracking-wide px-2.5 py-2 border-b border-line whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keeper.payouts.map((p, i) => (
              <tr key={i} className="hover:bg-surface2">
                <td className="px-2.5 py-2 border-b border-line-soft font-mono text-txt">
                  {shortenAddress(p.to)}
                </td>
                <td className="px-2.5 py-2 border-b border-line-soft font-mono tabular-nums text-txt2">
                  {formatQty(p.amount)}
                </td>
                <td className="px-2.5 py-2 border-b border-line-soft">
                  <a
                    href={`${EXPLORER}/${p.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan underline font-mono"
                  >
                    {shortenAddress(p.txHash)}
                  </a>
                </td>
                <td className="px-2.5 py-2 border-b border-line-soft text-txt3 whitespace-nowrap">
                  {timeAgo(p.timestampMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
