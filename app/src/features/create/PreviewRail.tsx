import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import type { DeployPreview } from "@meridian/sdk";
import type { WizardState } from "./types";
import { isWeightsMode, isManagedRebalance } from "./types";
import { sortedValidConstituents, hasDuplicateAddresses, weightSum, weightsBalanced, constituentsOk } from "./reducer";
import { randomSalt } from "./salt";
import { useCapabilities } from "../../capabilities/use-capabilities";
import { useApi } from "../../lib/api";
import { useTxPlan } from "../../wallet/use-tx-plan";
import { GateBanner } from "../../components/GateBanner";
import { formatBpsPct, formatUsd } from "../../lib/format";
import { Chip } from "../../components/Chip";
import { KV } from "../../components/KV";
import { HelpTip } from "../../components/HelpTip";
import { Button } from "../../components/Button";

interface Props {
  state: WizardState;
  /** Backend-derived preview (quantities + predicted vault); deploy relays its resolved unitQty. */
  preview?: DeployPreview;
  userSalt?: `0x${string}`;
}

/**
 * Map wizard state → deployTxRequestSchema. tokens follow validConstituents order so the
 * preview-resolved `unitQty[i]` stays aligned with `tokens[i]`; the deploy DTO is unchanged.
 */
export function buildDeployRequest(
  state: WizardState,
  account: string | undefined,
  unitQty: string[],
  userSalt: `0x${string}`,
) {
  const valid = sortedValidConstituents(state.constituents);
  const tokens = valid.map((c) => c.token.trim().toLowerCase());
  // Registry shares rebalance's field profile (manager + keeper economics); only vaultKind differs.
  const isRebalance = isManagedRebalance(state.vaultKind);
  const isManaged = state.vaultKind === "managed";

  const manager =
    isManaged || isRebalance
      ? (state.manager.trim() || account || "").toLowerCase()
      : undefined;

  return {
    account: (account ?? "").toLowerCase(),
    vaultKind: state.vaultKind,
    name: state.name,
    symbol: state.symbol,
    tokens,
    unitQty,
    unitSize: parseUnits(state.creationUnitSize || "1", 18).toString(),
    manager,
    managerFeeBps: isManaged || isRebalance ? Number(state.managerFeeBps || "0") : undefined,
    keeperBps: isRebalance ? Number(state.keeperBps || "0") : undefined,
    keeperEscrow:
      isRebalance && state.keeperEscrow.trim() ? state.keeperEscrow.trim().toLowerCase() : undefined,
    userSalt,
  };
}

export function PreviewRail({ state, preview, userSalt }: Props) {
  // Deploy gate does not depend on market status — pass "regular" as harmless default
  const caps = useCapabilities("regular");
  const deployGate = caps.canDeploy();
  const { address } = useAccount();
  const api = useApi();
  const tx = useTxPlan();

  const valid = sortedValidConstituents(state.constituents);
  const hasDuplicates = hasDuplicateAddresses(state.constituents);
  // Display-only: are the entered addresses well-formed and unique? The deploy gate uses
  // the mode-aware constituentsOk(state) below (which also enforces Σ=100 in weights mode).
  const addressesOk = valid.length >= 1 && !hasDuplicates;

  const weights = isWeightsMode(state.vaultKind);
  // Basket/Committed are genuinely fee-free; managed/rebalance/registry carry the manager + platform AUM legs.
  const hasOngoingFees = state.vaultKind === "managed" || isManagedRebalance(state.vaultKind);
  const sum = weightSum(state.constituents);
  const balanced = weightsBalanced(state.constituents);
  const sumLabel = `${(Math.round(sum * 10) / 10).toFixed(1)}%`;

  // Manager defaults to the connected wallet when blank (see buildDeployRequest); only a
  // non-empty malformed address blocks deploy.
  const managerOk =
    state.manager.trim() === "" || /^0x[0-9a-fA-F]{40}$/.test(state.manager.trim());

  const managedOk =
    state.vaultKind !== "managed" ||
    (managerOk && Number(state.managerFeeBps) >= 0 && Number(state.managerFeeBps) <= 200);

  const rebalanceOk =
    !isManagedRebalance(state.vaultKind) ||
    (managerOk &&
      Number(state.managerFeeBps) >= 0 &&
      Number(state.managerFeeBps) <= 200 &&
      Number(state.keeperBps) >= 0 &&
      Number(state.keeperBps) <= 2000);

  const allChecks =
    state.name.trim().length > 0 &&
    state.symbol.trim().length > 0 &&
    constituentsOk(state) &&
    managedOk &&
    rebalanceOk;

  const previewReady = Boolean(preview && !preview.gate.gated && preview.unitQty.length > 0);
  const running = tx.status === "running";
  const deployEnabled = allChecks && deployGate.enabled && previewReady;

  const deployStatus =
    tx.status === "success"
      ? "Deployed ✓"
      : running
        ? "Deploying…"
        : tx.error
          ? `Failed: ${tx.error}`
          : null;

  function handleDeploy() {
    const salt = userSalt ?? randomSalt();
    void tx.run(() => api.buildDeployTx(buildDeployRequest(state, address, preview?.unitQty ?? [], salt)));
  }

  return (
    <aside
      className="border-l border-line bg-bg2 flex flex-col"
      aria-label="Deploy preview"
    >
      {/* rail header */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-line">
        <span className="text-xs font-bold tracking-wide">LIVE PREVIEW</span>
        <span className="flex-1" />
        <Chip variant="info">building</Chip>
      </div>

      {/* identity */}
      <div className="px-3.5 py-3.5 border-b border-line">
        <div className="text-[9.5px] uppercase tracking-widest text-txt3 mb-2">Your index</div>
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-lg grid place-items-center font-mono font-bold text-[11px] bg-gradient-to-br from-cyan to-emerald text-[#06080a]">
            {(state.symbol || "IX").slice(0, 2)}
          </span>
          <div className="min-w-0">
            <div className="font-mono text-base font-bold">
              {state.symbol || <span className="text-txt3">SYMBOL</span>}
            </div>
            <div className="text-[10.5px] text-txt2 truncate">
              {state.name || <span className="text-txt3">Name</span>}
            </div>
          </div>
          <Chip variant="violet" className="ml-auto">
            {state.vaultKind}
          </Chip>
        </div>
      </div>

      {/* constituents mirror */}
      <div className="px-3.5 py-3.5 border-b border-line">
        <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-widest text-txt3 mb-2">
          Constituents
          <HelpTip>Live mirror of the constituents step — {weights ? "target weight" : "quantity"} per token. Updates as you edit.</HelpTip>
        </div>
        {state.constituents.length > 0 ? (
          <div className="flex flex-col">
            {state.constituents.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 py-1.5 border-b border-line-soft last:border-b-0 text-[11px]"
              >
                <span className="font-mono text-txt truncate">{c.token || "—"}</span>
                <span className="flex-1" />
                <span className="font-mono text-txt">{c.amount || "—"}</span>
              </div>
            ))}
            {state.constituents.length > 6 && (
              <p className="text-[10px] text-txt3 pt-1.5">+{state.constituents.length - 6} more</p>
            )}
          </div>
        ) : (
          <p className="text-[10.5px] text-txt3">No constituents yet.</p>
        )}
      </div>

      {/* validation */}
      <div className="px-3.5 py-3.5 border-b border-line">
        <div className="text-[9.5px] uppercase tracking-widest text-txt3 mb-2">Validation</div>
        {weights && (
          <KV
            label="Weights sum"
            value={<span className={balanced ? "text-emerald" : "text-amber"}>{sumLabel}{balanced ? " ✓" : ""}</span>}
          />
        )}
        <KV label="Constituents" value={String(valid.length)} />
        {weights && <KV label="Value / unit" value={`$${state.valuePerUnitUsd || "0"}`} />}
        <KV
          label="Addresses"
          value={
            <span className={addressesOk ? "text-emerald" : "text-amber"}>
              {addressesOk ? "valid" : "incomplete"}
            </span>
          }
        />
        <KV label="Creation unit" value={`${state.creationUnitSize}`} />
        <KV label="Listing gate" value={<span className="text-emerald">all pass</span>} />
      </div>

      {/* fees */}
      <div className="px-3.5 py-3.5 border-b border-line">
        <KV label="Flow fee (mint/redeem)" value={<span className="text-emerald">0%</span>} />
        {hasOngoingFees ? (
          <>
            <KV label="Manager fee" value={`${formatBpsPct(Number(state.managerFeeBps || "0"))} / yr`} />
            {isManagedRebalance(state.vaultKind) && (
              <KV label="Keeper cut (of mgr fee)" value={formatBpsPct(Number(state.keeperBps || "0"))} />
            )}
            <KV label="Platform AUM fee" value="≤ 0.5% / yr" />
            {preview?.creationFee && (
              <KV
                label="Fund-creation fee"
                value={`${formatUsd(preview.creationFee.valueUsd)} once`}
              />
            )}
          </>
        ) : (
          <KV label="Other fees" value={<span className="text-emerald">none</span>} />
        )}
      </div>

      {/* CTA */}
      <div className="px-3.5 py-3.5 flex flex-col gap-2.5">
        <GateBanner gate={deployGate} />
        {preview?.gate.gated && (
          <p
            aria-label="preview gate reason"
            className="flex items-start gap-2 px-2.5 py-2 rounded-md border border-amber/30 bg-amber/[0.06] text-[11.5px] text-amber"
          >
            <span className="mt-px" aria-hidden>⚑</span>
            <span>{preview.gate.reason}</span>
          </p>
        )}
        <Button
          variant="primary"
          full
          className="py-3"
          disabled={!deployEnabled || running}
          onClick={handleDeploy}
          aria-label="Review and deploy"
        >
          {running ? "Deploying…" : "Review & deploy →"}
        </Button>
        <p className="text-[10px] text-txt3 text-center">
          Gas only · oracle-free in-kind mint from block one.
        </p>

        {deployStatus && (
          <div className="flex flex-col gap-1 text-xs" aria-label="deploy status">
            <span className={tx.error ? "text-red" : "text-txt"}>{deployStatus}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
