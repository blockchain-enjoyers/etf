import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { BasketDetail, SettleGateStatus } from "@meridian/sdk";
import { Button } from "../../components/Button";
import { GateBanner } from "../../components/GateBanner";
import { EstBadge } from "../../components/EstBadge";
import { queryKeys } from "../../lib/query";
import { useApi } from "../../lib/api";
import { useCapabilities } from "../../capabilities/use-capabilities";
import { useForwardQueue } from "../../data/useForwardQueue";
import { useTxPlan } from "../../wallet/use-tx-plan";

interface Props {
  vaultAddress: string;
  basket: BasketDetail;
  gate: SettleGateStatus | null;
}

function parse18(value: string): bigint {
  try {
    return parseUnits(value, 18);
  } catch {
    return 0n;
  }
}

export function ForwardRedeemPanel({ vaultAddress, basket, gate }: Props) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const cap = useCapabilities("regular").canForwardRedeem();

  const shares = parse18(amount);
  // Plan destinations: approve → the share token (vault clone), requestRedeem → the per-vault queue
  // clone. Neither is in the static address book, so seed both into the tx-plan allowlist.
  const { data: queue } = useForwardQueue(vaultAddress, true);
  const tx = useTxPlan([vaultAddress, queue?.queueAddress].filter(Boolean) as string[]);
  const running = tx.status === "running";

  // Estimate only (IRON RULE): est USD = shares(18-dec) * navPerShare(1e18 wad) / 1e18 -> 18-dec USD, shown human-readable. Real cashOut (net of AP spread) is struck at the next open print.
  const navPerShare = gate?.navPerShare ? BigInt(gate.navPerShare) : 0n;
  const estCashUsd = navPerShare > 0n ? (shares * navPerShare) / 1_000_000_000_000_000_000n : 0n;

  function handleRedeem() {
    if (shares <= 0n) return;
    void tx
      .run(() => api.buildForwardRedeemTx(vaultAddress, { shares: shares.toString(), account: address! }))
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.forwardTickets(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.forwardQueue(vaultAddress) });
      });
  }

  const currentLabel = tx.steps[tx.currentStep]?.label;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-stretch border border-line rounded-md overflow-hidden bg-bg">
        <span className="grid place-items-center px-3 bg-surface2 text-txt3 font-mono text-xs border-r border-line">
          {basket.symbol}
        </span>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="flex-1 bg-transparent font-mono text-sm text-txt placeholder:text-txt3 px-3 py-2.5 focus:outline-none"
          aria-label="Shares amount"
        />
      </div>

      <div className="flex items-center justify-between py-1.5 border-b border-line-soft text-[11.5px]">
        <span className="text-txt2">You receive (estimate)</span>
        <span className="inline-flex items-center gap-1 font-mono font-semibold tabular-nums">
          {navPerShare > 0n ? formatUnits(estCashUsd, 18) : "—"} USDG
          <EstBadge />
        </span>
      </div>
      <p className="text-[10.5px] text-txt3 leading-relaxed">
        Forward-priced: settles at the next market open at the open NAV, less the AP spread — not this estimate.
      </p>

      {cap.enabled ? (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            full
            onClick={handleRedeem}
            disabled={running || shares === 0n}
            aria-label="Queue redeem order"
          >
            {running ? "Queueing…" : "Queue redeem (AP)"}
          </Button>
          {tx.total > 0 && (
            <div className="flex items-center justify-between text-[11px] text-txt3">
              <span>{currentLabel ?? (tx.status === "success" ? "Confirmed ✓" : "Working…")}</span>
              <span>
                {Math.min(tx.currentStep + (running ? 1 : 0), tx.total)} / {tx.total}
              </span>
            </div>
          )}
          {tx.status === "success" && (
            <div className="flex flex-col gap-1 text-xs" aria-label="transaction status">
              <span className="text-emerald">Confirmed ✓</span>
            </div>
          )}
          {tx.error && (
            <div className="flex flex-col gap-1 text-xs" aria-label="transaction status">
              <span className="text-red">Failed: {tx.error}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button full disabled aria-label="Queue redeem order">
            🔒 Queue redeem (AP only)
          </Button>
          <GateBanner gate={cap} />
        </div>
      )}
    </div>
  );
}
