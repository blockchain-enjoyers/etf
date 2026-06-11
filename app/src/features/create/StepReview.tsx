import { useAccount } from "wagmi";
import type { DeployPreview } from "@meridian/sdk";
import type { WizardState, WizardAction } from "./types";
import { isWeightsMode } from "./types";
import { sortedValidConstituents, constituentsOk, hasDuplicateAddresses, weightSum } from "./reducer";
import { buildDeployRequest } from "./PreviewRail";
import { useCapabilities } from "../../capabilities/use-capabilities";
import { useAvailability } from "../../data/useAvailability";
import { useApi } from "../../lib/api";
import { useTxPlan } from "../../wallet/use-tx-plan";
import { Chip } from "../../components/Chip";
import { Button } from "../../components/Button";
import { cn } from "../../lib/cn";

interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onBack: () => void;
  /** Backend-derived preview (quantities + predicted vault); deploy relays its resolved unitQty. */
  preview?: DeployPreview;
  userSalt: `0x${string}`;
}

export function StepReview({ state, onBack, preview, userSalt }: Props) {
  // Deploy gate does not depend on market status — pass "regular" as harmless default.
  const caps = useCapabilities("regular");
  const deployGate = caps.canDeploy();
  const { address } = useAccount();
  const api = useApi();

  const valid = sortedValidConstituents(state.constituents);
  const tokens = valid.map((c) => c.token.trim().toLowerCase());
  const predicted = preview?.predictedVault ?? undefined;

  // Fixed call order: deployTx first, scheduleTx second. The schedule plan is seeded with
  // [predicted, ...tokens] so assertTxPlanSafe accepts the fresh clone address as a `to` target.
  const deployTx = useTxPlan(tokens);
  const scheduleTx = useTxPlan(predicted ? [predicted, ...tokens] : tokens);

  // The new vault's backend row is written asynchronously by the indexer; the curatorSchedule
  // plan stays gated ("not-deployed") until then. Called unconditionally; the hook no-ops when
  // predicted is empty (enabled: Boolean(vaultAddress)).
  const availability = useAvailability(predicted ?? "", (address ?? "").toLowerCase());
  const ctaReady = availability.data?.items?.find((i) => i.action === "curatorSchedule")?.enabled === true;

  const weights = isWeightsMode(state.vaultKind);
  const sum = weightSum(state.constituents);
  const balanced = Math.abs(sum - 100) < 0.05;
  const sumLabel = `${(Math.round(sum * 10) / 10).toFixed(1)}%`;
  const noDuplicates = !hasDuplicateAddresses(state.constituents);

  // Manager defaults to the connected wallet when blank (see buildDeployRequest); only a
  // non-empty malformed address blocks deploy.
  const managerOk =
    state.manager.trim() === "" || /^0x[0-9a-fA-F]{40}$/.test(state.manager.trim());

  const managedOk =
    state.vaultKind !== "managed" ||
    (managerOk && Number(state.managerFeeBps) >= 0 && Number(state.managerFeeBps) <= 200);

  const rebalanceOk =
    state.vaultKind !== "rebalance" ||
    (managerOk &&
      Number(state.managerFeeBps) >= 0 &&
      Number(state.managerFeeBps) <= 200 &&
      Number(state.keeperBps) >= 0 &&
      Number(state.keeperBps) <= 2000);

  const previewOk = Boolean(preview) && !preview!.gate.gated && preview!.unitQty.length > 0;
  const allChecks =
    state.name.trim().length > 0 &&
    state.symbol.trim().length > 0 &&
    constituentsOk(state) &&
    managedOk &&
    rebalanceOk &&
    previewOk;

  const deployEnabled = allChecks && deployGate.enabled;
  const deploying = deployTx.status === "running";
  const deployed = deployTx.status === "success";
  const isRebalance = state.vaultKind === "rebalance";

  const deployStatus =
    deployTx.status === "success"
      ? "Deployed ✓"
      : deploying
        ? "Deploying…"
        : deployTx.error
          ? `Failed: ${deployTx.error}`
          : null;

  // Per-token qty/value comes from the preview breakdown (price-resolved) when present.
  const byToken = new Map(preview?.breakdown.map((b) => [b.token.toLowerCase(), b]) ?? []);

  function handleDeploy() {
    if (!preview) return;
    void deployTx.run(() => api.buildDeployTx(buildDeployRequest(state, address, preview.unitQty, userSalt)));
  }
  function handleSchedule() {
    if (!predicted || !preview) return;
    void scheduleTx.run(() =>
      api.buildCuratorScheduleTx(predicted, {
        tokens,
        unitQty: preview.unitQty,
        account: (address ?? "").toLowerCase(),
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-line rounded-lg bg-surface overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line bg-surface2">
          <span className="w-9 h-9 rounded-lg grid place-items-center font-mono font-bold text-[13px] bg-gradient-to-br from-cyan to-emerald text-[#06080a]">
            {(state.symbol || "IX").slice(0, 2)}
          </span>
          <div className="min-w-0">
            <div className="font-mono font-bold text-xl tracking-wide">{state.symbol || "—"}</div>
            <div className="text-xs text-txt2 truncate">{state.name || "—"}</div>
          </div>
          <span className="flex-1" />
          <span className="font-mono text-[9px] uppercase tracking-widest text-violet border border-[#2c2740] bg-surface3 px-2 py-1 rounded">
            {state.vaultKind}
          </span>
        </div>

        <div className="grid grid-cols-2">
          <ReviewCell k="Constituents" v={`${valid.length} holdings`} />
          {weights && (
            <ReviewCell
              k="Weights sum"
              v={<span className={balanced ? "text-emerald" : "text-amber"}>{sumLabel}{balanced ? " ✓" : ""}</span>}
            />
          )}
          {weights && <ReviewCell k="Value / unit" v={`$${state.valuePerUnitUsd || "0"}`} />}
          <ReviewCell k="Creation unit" v={`${state.creationUnitSize} tokens`} />
        </div>

        <div className="px-4 py-2.5 border-t border-line bg-surface2 text-[11px] font-semibold tracking-wide">
          Composition {weights ? "(target weights)" : "(per unit)"}
        </div>
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-txt3">
              <th className="text-left font-semibold px-4 py-2 border-b border-line">Token</th>
              <th className="text-right font-semibold px-4 py-2 border-b border-line">
                {weights ? "Target %" : "Qty / unit"}
              </th>
              <th className="text-right font-semibold px-4 py-2 border-b border-line">Value</th>
              <th className="text-left font-semibold px-4 py-2 border-b border-line">Listing gate</th>
            </tr>
          </thead>
          <tbody>
            {state.constituents.map((c) => {
              const b = byToken.get(c.token.trim().toLowerCase());
              return (
                <tr key={c.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-4 py-2 font-mono text-txt truncate max-w-[1px]">{c.token || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {weights ? (c.amount ? `${c.amount}%` : "—") : (b?.qty ?? c.amount ?? "—")}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-txt2">{b ? `${b.qty}` : "—"}</td>
                  <td className="px-4 py-2">
                    <Chip variant="ok">✓ pass</Chip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* what happens on deploy */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border border-cyan-dim bg-cyan/[0.05] text-[11.5px]">
        <span aria-hidden className="mt-px">⚙</span>
        <div>
          <b className="font-semibold">What happens on deploy</b>
          <p className="text-txt2 mt-1 leading-relaxed">
            Meridian deploys an <span className="text-cyan font-semibold">immutable EIP-1167 clone vault</span>,
            registers the on-chain composition (constituents + {weights ? "target weights" : "quantities"}), and
            wires the engines by role. The index is immediately ready for in-kind mint — the oracle-free spine
            that always works, even when the market is closed.
          </p>
        </div>
      </div>

      {/* pre-flight checks */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] uppercase tracking-wide text-txt3 font-semibold">Pre-flight checks</p>
        <Check ok={state.name.trim().length > 0} label="Name is set" />
        <Check ok={state.symbol.trim().length > 0} label="Symbol is set" />
        <Check ok={valid.length >= 1} label="At least one valid constituent" />
        <Check ok={valid.length >= 1 && noDuplicates} label="Token addresses valid (no duplicates)" />
        <Check ok={previewOk} label="Quantities resolved (preview ready)" />
      </div>

      {predicted && (
        <p className="text-[11px] text-txt2">
          Deploys to <span className="font-mono text-cyan">{predicted}</span>
        </p>
      )}

      {/* deploy CTA */}
      <Button
        variant="primary"
        full
        className="py-3 text-[13px]"
        disabled={!deployEnabled || deploying}
        onClick={handleDeploy}
      >
        ⚡ {deploying ? "Deploying…" : `Deploy index${state.symbol ? ` — ${state.symbol}` : ""}`}
      </Button>
      <p className="text-[10px] text-txt3 text-center">
        Gas only · <b className="text-emerald">zero protocol fee</b>. Vault address is permanent once deployed.
      </p>

      {deployStatus && (
        <div className="flex flex-col gap-1 text-xs" aria-label="deploy status">
          <span className={deployTx.error ? "text-red" : "text-txt"}>{deployStatus}</span>
        </div>
      )}

      {/* rebalance-only: arm the keeper target from the entered weights */}
      {deployed && isRebalance && (
        <div
          className="border border-cyan-dim rounded-lg bg-cyan/[0.05] p-3 flex flex-col gap-2"
          aria-label="set target weights"
        >
          <b className="text-[12px]">Set target weights</b>
          <p className="text-[11px] text-txt2 leading-relaxed">
            Arms the keeper&apos;s rebalance target from the weights you entered. This{" "}
            <b>schedules a timelocked target</b>; activate it in Manage once the delay elapses.
          </p>
          <Button
            variant="primary"
            disabled={!predicted || !ctaReady || scheduleTx.status === "running"}
            onClick={handleSchedule}
          >
            {scheduleTx.status === "success"
              ? "Target scheduled ✓"
              : scheduleTx.status === "running"
                ? "Scheduling…"
                : !ctaReady
                  ? "Indexing new vault…"
                  : "Set target weights"}
          </Button>
          {scheduleTx.error && <span className="text-[11px] text-red">{scheduleTx.error}</span>}
        </div>
      )}

      <div className="flex items-center gap-3 pt-3 border-t border-line">
        <Button variant="default" onClick={onBack}>
          ← Back
        </Button>
      </div>
    </div>
  );
}

function ReviewCell({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 border-b border-line-soft odd:border-r odd:border-r-line-soft">
      <div className="text-[9px] uppercase tracking-wider text-txt3">{k}</div>
      <div className="font-mono text-[13px] font-semibold mt-0.5">{v}</div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={ok ? "text-emerald" : "text-txt3"}>{ok ? "✓" : "○"}</span>
      <span className={cn(ok ? "text-txt" : "text-txt3")}>{label}</span>
    </div>
  );
}
