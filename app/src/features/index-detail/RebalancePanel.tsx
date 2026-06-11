import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { RebalanceDetail } from "@meridian/sdk";
import { Button } from "../../components/Button";
import { GateBanner } from "../../components/GateBanner";
import { shortenAddress, formatQty } from "../../lib/format";
import { queryKeys } from "../../lib/query";
import { useApi } from "../../lib/api";
import { useCapabilities } from "../../capabilities/use-capabilities";
import { useTxPlan } from "../../wallet/use-tx-plan";

interface Props {
  vaultAddress: string;
  manager: string;
  detail: RebalanceDetail;
}

interface TargetRow {
  token: string;
  qty: string;
}

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "Ready to activate";
  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `Activates in ${h}h ${m}m`;
}

const SEC_CLASS = "text-[10px] uppercase tracking-wider text-txt3 mb-1.5";
const INPUT_CLASS =
  "border border-line rounded px-2 py-1 font-mono text-xs bg-surface2 text-txt placeholder:text-txt3 focus:outline-none focus:border-cyan";

export function RebalancePanel({ vaultAddress, manager, detail }: Props) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const gate = useCapabilities("regular").canCurate(manager);
  // Curator schedule/activate target the vault clone, which isn't in the static address book — seed it.
  const tx = useTxPlan([vaultAddress]);
  const running = tx.status === "running";

  const initialRows: TargetRow[] =
    detail.target.length > 0
      ? detail.target.map((c) => ({ token: c.token, qty: c.unitQty }))
      : [{ token: "", qty: "" }];

  const [rows, setRows] = useState<TargetRow[]>(initialRows);

  function handleSchedule() {
    if (!gate.enabled) return;
    const tokens = rows.map((r) => r.token);
    const unitQty = rows.map((r) => {
      try {
        return parseUnits(r.qty, 18).toString();
      } catch {
        return "0";
      }
    });
    void tx
      .run(() => api.buildCuratorScheduleTx(vaultAddress, { tokens, unitQty, account: address! }))
      .then(() => qc.invalidateQueries({ queryKey: queryKeys.rebalance(vaultAddress) }));
  }

  function handleActivate() {
    if (!gate.enabled) return;
    void tx
      .run(() => api.buildCuratorActivateTx(vaultAddress, { account: address! }))
      .then(() => qc.invalidateQueries({ queryKey: queryKeys.rebalance(vaultAddress) }));
  }

  const pending = detail.pendingTarget;
  const remainingMs = pending ? pending.effectiveAtMs - Date.now() : 0;
  const activateDisabled = !gate.enabled || !pending || remainingMs > 0 || running;

  return (
    <div>
      <div className={SEC_CLASS}>Curator</div>

      <GateBanner gate={gate} />

      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wider text-txt3 mb-1">Schedule new target</div>
        <div className="flex flex-col gap-1.5 mb-2">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={row.token}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { token: e.target.value, qty: next[i]!.qty };
                  setRows(next);
                }}
                placeholder="0x token address"
                className={"flex-1 " + INPUT_CLASS}
                aria-label={`Token address row ${i + 1}`}
              />
              <input
                type="text"
                value={row.qty}
                onChange={(e) => {
                  const next = [...rows];
                  next[i] = { token: next[i]!.token, qty: e.target.value };
                  setRows(next);
                }}
                placeholder="unit qty"
                className={"w-28 " + INPUT_CLASS}
                aria-label={`Unit qty row ${i + 1}`}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setRows((r) => [...r, { token: "", qty: "" }])}
            disabled={!gate.enabled}
            className="text-[11px]"
          >
            + Add row
          </Button>
          <Button
            variant={gate.enabled ? "primary" : "default"}
            onClick={handleSchedule}
            disabled={!gate.enabled || running}
            aria-label="Schedule new target"
          >
            Schedule new target
          </Button>
        </div>
      </div>

      {pending && (
        <div className="border border-line rounded-lg p-3 bg-surface2">
          <div className="text-[10px] uppercase tracking-wider text-txt3 mb-1.5">Pending target</div>
          <div className="flex flex-col gap-1 mb-3">
            {pending.tokens.map((t) => (
              <div key={t.token} className="flex items-center justify-between text-[12px]">
                <span className="font-mono text-txt2 text-xs">{shortenAddress(t.token)}</span>
                <span className="font-mono text-txt tabular-nums">{formatQty(t.unitQty)}</span>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-txt2 mb-2">{formatCountdown(remainingMs)}</div>
          <Button
            variant={activateDisabled ? "default" : "primary"}
            full
            onClick={handleActivate}
            disabled={activateDisabled}
            aria-label="Activate target"
          >
            Activate
          </Button>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {tx.total > 0 && (
          <div className="flex items-center justify-between text-[11px] text-txt3">
            <span>{tx.steps[tx.currentStep]?.label ?? (tx.status === "success" ? "Confirmed ✓" : "Working…")}</span>
            <span>
              {Math.min(tx.currentStep + (running ? 1 : 0), tx.total)} / {tx.total}
            </span>
          </div>
        )}
        {(tx.status === "success" || tx.error) && (
          <div className="flex flex-col gap-1 text-xs" aria-label="transaction status">
            {tx.status === "success" && <span className="text-emerald">Confirmed ✓</span>}
            {tx.error && <span className="text-red">Failed: {tx.error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
