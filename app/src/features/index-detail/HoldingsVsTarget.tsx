import type { RebalanceDetail } from "@meridian/sdk";
import { shortenAddress, formatQty } from "../../lib/format";

interface Props {
  detail: RebalanceDetail;
}

const TH =
  "text-left text-txt3 font-semibold text-[10px] uppercase tracking-wider px-2.5 py-[9px] border-b border-line whitespace-nowrap";
const TD = "px-2.5 py-[9px] border-b border-line-soft align-middle font-mono text-xs tabular-nums";

export function HoldingsVsTarget({ detail }: Props) {
  const { heldTokens, target } = detail;

  if (heldTokens.length === 0 && target.length === 0) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wider text-txt3 mb-1.5">Holdings vs Target</div>
        <p className="text-[12px] text-txt2">No holdings yet</p>
      </div>
    );
  }

  const allTokens = Array.from(
    new Set([...heldTokens.map((h) => h.token), ...target.map((t) => t.token)]),
  );

  const heldMap = new Map(heldTokens.map((h) => [h.token, h.balance]));
  const targetMap = new Map(target.map((t) => [t.token, t.unitQty]));

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-txt3 mb-1.5">Holdings vs Target</div>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className={TH}>Token</th>
            <th className={TH}>Held</th>
            <th className={TH}>Target</th>
          </tr>
        </thead>
        <tbody>
          {allTokens.map((token) => {
            const held = heldMap.get(token);
            const tgt = targetMap.get(token);
            return (
              <tr key={token}>
                <td className={`${TD} text-txt`}>{shortenAddress(token)}</td>
                <td className={`${TD} text-txt2`}>{held != null ? formatQty(held) : "—"}</td>
                <td className={`${TD} text-txt2`}>{tgt != null ? formatQty(tgt) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
