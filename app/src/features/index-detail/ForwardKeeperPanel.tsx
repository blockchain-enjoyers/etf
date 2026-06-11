import { useAccount } from "wagmi";
import type { ForwardTicket } from "@meridian/sdk";
import { Button } from "../../components/Button";
import { GateBanner } from "../../components/GateBanner";
import { useApi } from "../../lib/api";
import { useCapabilities } from "../../capabilities/use-capabilities";
import { useTxPlan } from "../../wallet/use-tx-plan";

interface Props {
  vaultAddress: string;
  manager: string;
  heldTokens: string[];
  tickets: ForwardTicket[];
  apFiller: string;
  /** Settlement is hard-blocked until every settle-guard passes (g6 et al). */
  guardsBlocked?: boolean;
}

export function ForwardKeeperPanel({
  vaultAddress,
  manager,
  heldTokens,
  tickets,
  apFiller,
  guardsBlocked,
}: Props) {
  const api = useApi();
  const { address } = useAccount();
  const gate = useCapabilities("regular").canForwardKeeper(manager);
  // Record/settle target the BasketNavObserver / ForwardCashQueue singletons (in the static
  // address book) — no seed needed.
  const tx = useTxPlan();
  const running = tx.status === "running";

  const now = Date.now();
  const pastCutoffIds = tickets
    .filter((t) => (t.status === "pending" || t.status === "partial") && t.cutoffMs <= now)
    .map((t) => t.id);
  const canSettle =
    gate.enabled && !running && !guardsBlocked && pastCutoffIds.length > 0 && heldTokens.length > 0 && !!apFiller;

  function handleRecord() {
    if (!gate.enabled) return;
    void tx.run(() => api.buildKeeperRecordTx(vaultAddress, { account: address! }));
  }

  function handleSettle() {
    if (!canSettle) return;
    void tx.run(() =>
      api.buildKeeperSettleTx(vaultAddress, { ticketIds: pastCutoffIds, ap: apFiller, account: address! }),
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] text-txt2">
        Manual ops for when the Forward Operator bot is off. Record keeps the TWAP fresh; Settle prices
        the past-cutoff batch at the next open print.
      </p>

      {!gate.enabled && <GateBanner gate={gate} />}

      <div className="flex gap-2">
        <Button
          onClick={handleRecord}
          disabled={!gate.enabled || running || heldTokens.length === 0}
          aria-label="Record observation"
        >
          Record TWAP
        </Button>
        <Button variant="primary" onClick={handleSettle} disabled={!canSettle} aria-label="Settle batch">
          Settle tickets
        </Button>
      </div>

      {gate.enabled && guardsBlocked && (
        <p className="text-[10.5px] text-amber">Settle is locked until the checklist clears.</p>
      )}

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
  );
}
