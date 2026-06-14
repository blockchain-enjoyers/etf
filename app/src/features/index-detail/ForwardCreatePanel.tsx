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
import { useTxPlan } from "../../wallet/use-tx-plan";

interface Props {
  vaultAddress: string;
  basket: BasketDetail;
  gate: SettleGateStatus | null;
  bootstrapped: boolean;
}

const USDC_DECIMALS = 6;

function parseUsdc(value: string): bigint {
  try {
    return parseUnits(value, USDC_DECIMALS);
  } catch {
    return 0n;
  }
}

export function ForwardCreatePanel({ vaultAddress, basket, gate, bootstrapped }: Props) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const cap = useCapabilities("regular").canForwardCreate(vaultAddress, bootstrapped);

  const cash = parseUsdc(amount);
  const cashToken = basket.cashToken ?? "";
  // The plan's approve step targets the cash token, which isn't in the static address book — seed it.
  const tx = useTxPlan(cashToken ? [cashToken] : []);
  const running = tx.status === "running";

  // Estimate only (IRON RULE): shares = netCash(=cash, spread shown at settle) * 1e18 / navPerShare.
  const navPerShare = gate?.navPerShare ? BigInt(gate.navPerShare) : 0n;
  const estShares =
    navPerShare > 0n ? (parseUnits(formatUnits(cash, USDC_DECIMALS), 18) * 1_000_000_000_000_000_000n) / navPerShare : 0n;

  function handleCreate() {
    if (cash <= 0n) return;
    void tx
      .run(() => api.buildForwardCreateTx(vaultAddress, { cash: cash.toString(), account: address! }))
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
          USDG
        </span>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="flex-1 bg-transparent font-mono text-sm text-txt placeholder:text-txt3 px-3 py-2.5 focus:outline-none"
          aria-label="USDG amount"
        />
      </div>

      <div className="flex items-center justify-between py-1.5 border-b border-line-soft text-[11.5px]">
        <span className="text-txt2">You receive (estimate)</span>
        <span className="inline-flex items-center gap-1 font-mono font-semibold tabular-nums">
          {navPerShare > 0n ? formatUnits(estShares, 18) : "—"} {basket.symbol}
          <EstBadge />
        </span>
      </div>
      <p className="text-[10.5px] text-txt3 leading-relaxed">
        Forward-priced: settles at the next market open at the open NAV, not this estimate.
      </p>

      {cap.enabled ? (
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            full
            onClick={handleCreate}
            disabled={running || cash === 0n}
            aria-label="Queue create order"
          >
            {running ? "Queueing…" : "Queue create (AP)"}
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
          <Button full disabled aria-label="Queue create order">
            🔒 Queue create (AP only)
          </Button>
          <GateBanner gate={cap} />
        </div>
      )}
    </div>
  );
}
