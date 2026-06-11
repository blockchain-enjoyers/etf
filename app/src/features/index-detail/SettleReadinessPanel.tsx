import { formatUnits } from "viem";
import type { SettleGateGuardId, SettleGateStatus } from "@meridian/sdk";
import { EstBadge } from "../../components/EstBadge";
import { Guard } from "../../components/Guard";

interface Props {
  gate: SettleGateStatus | null;
}

// Plain-English decode of the on-chain guard ids (g0…g8). One pending/blocked check stops settlement.
const GUARD_COPY: Record<SettleGateGuardId, { title: string; detail: string }> = {
  g0: { title: "Vault bootstrapped", detail: "The vault holds initial assets and is live." },
  g1: { title: "Price feeds configured", detail: "Oracle routes exist for every constituent." },
  g2: { title: "Market open", detail: "Regular session — settlement uses a real, authoritative price." },
  g3: { title: "NAV safe", detail: "NAV computed cleanly — no stale or missing leg." },
  g6: { title: "Enough recent price prints", detail: "A few fresh TWAP observations are required so settlement can't hinge on one bad tick." },
  g7: { title: "Price within band", detail: "Recorded price sits inside the safety band — no outlier." },
  g8: { title: "Peg healthy", detail: "USDC cash leg is at peg — settlement value is trustworthy." },
};

// g6 (insufficient prints) is a "just wait" condition → PENDING; any other failing guard is a hard BLOCK.
function guardStatus(id: SettleGateGuardId, ok: boolean): "pass" | "pend" | "bad" {
  if (ok) return "pass";
  return id === "g6" ? "pend" : "bad";
}

export function SettleReadinessPanel({ gate }: Props) {
  const guards = gate?.guards ?? [];
  const allPass = guards.length > 0 && guards.every((g) => g.ok);

  return (
    <div>
      <p className="text-[11px] text-txt2 px-3 pt-3 pb-2">
        Decision-only: a green gate means the next open print can settle the queue. The NAV shown is an
        estimate, never the settlement price.
      </p>

      <div className="flex gap-6 text-xs px-3 pb-3">
        <div>
          <span className="text-txt3 text-[10px] uppercase tracking-wide">NAV / share</span>
          <div className="inline-flex items-center gap-1 font-mono tabular-nums text-txt">
            {gate?.navPerShare ? formatUnits(BigInt(gate.navPerShare), 18) : "—"}
            <EstBadge />
          </div>
        </div>
        <div>
          <span className="text-txt3 text-[10px] uppercase tracking-wide">TWAP</span>
          <div className="font-mono tabular-nums text-txt">
            {gate?.twap ? formatUnits(BigInt(gate.twap), 18) : "—"}
          </div>
        </div>
      </div>

      <div className="flex flex-col border-t border-line">
        {guards.map((g) => {
          const copy = GUARD_COPY[g.id];
          const status = guardStatus(g.id, g.ok);
          return (
            <Guard
              key={g.id}
              status={status}
              title={copy.title}
              detail={g.ok ? copy.detail : g.reason ?? copy.detail}
              code={g.id}
            />
          );
        })}
      </div>

      {!allPass && (
        <p className="text-[10.5px] text-amber px-3 py-2.5 border-t border-line">
          Settlement is blocked until every check passes.
        </p>
      )}
    </div>
  );
}
