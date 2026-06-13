import type { WizardState, WizardAction } from "./types";
import { isWeightsMode } from "./types";
import {
  isRowEmpty, isAddress, hasDuplicateAddresses,
  validConstituents, weightSum, weightsBalanced, constituentsOk,
} from "./reducer";
import { Module } from "../../components/Module";
import { Chip } from "../../components/Chip";
import { HelpPopover } from "../../components/HelpPopover";
import { CREATE_HELP } from "./help-content";
import { Button } from "../../components/Button";
import { cn } from "../../lib/cn";
import { TokenPicker } from "./TokenPicker";

interface PreviewRow { token: string; qty: string; weightBps: number; valueUsd?: string }
interface Props {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onBack: () => void;
  onNext: () => void;
  /** Price-derived per-row figures from useDeployPreview; absent until P3 (cells show "—"). */
  preview?: { breakdown: PreviewRow[]; priceMissing: string[] };
}

const inputCls = "border border-line bg-surface text-txt font-mono text-sm px-2 py-1 rounded-md focus:outline-none focus:border-cyan";

function rowHint(c: WizardState["constituents"][number]): { text: string; ok: boolean } | null {
  if (isRowEmpty(c)) return null;
  if (!isAddress(c.token)) return { text: "⚠ invalid address", ok: false };
  const n = parseFloat(c.amount);
  if (!Number.isFinite(n) || n <= 0) return { text: "⚠ must be > 0", ok: false };
  return { text: "✓ valid", ok: true };
}

export function StepConstituents({ state, dispatch, onBack, onNext, preview }: Props) {
  const weights = isWeightsMode(state.vaultKind);
  const amountHeader = weights ? "Target %" : "Qty / unit";
  const derivedHeader = weights ? "→ qty" : "≈ weight";
  const canNext = constituentsOk(state);

  const sum = weightSum(state.constituents);
  const balanced = weightsBalanced(state.constituents);
  const byToken = new Map(preview?.breakdown.map((b) => [b.token.toLowerCase(), b]) ?? []);

  return (
    <div className="flex flex-col gap-4">
      <Module
        title="Basket constituents"
        help={weights
          ? "Set each token's target weight (must total 100%). The backend derives the starting token amounts from live prices."
          : "Set the exact token quantity per creation unit. 1 unit is minted in-kind by depositing these amounts."}
        right={<Chip variant="info">{weights ? "target weights" : "quantities"}</Chip>}
        bodyClassName="p-0"
      >
        <table className="w-full table-fixed text-[11.5px]">
          <colgroup>
            <col style={{ width: "48%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-txt3">
              <th className="text-left font-semibold px-3 py-2 border-b border-line">
                <span className="inline-flex items-center gap-1.5"><span>Token address</span><HelpPopover {...CREATE_HELP.token} /></span>
              </th>
              <th className="text-right font-semibold px-3 py-2 border-b border-line">
                <span className="inline-flex items-center gap-1.5 justify-end"><span>{amountHeader}</span><HelpPopover {...CREATE_HELP[weights ? "targetPct" : "qtyPerUnit"]} /></span>
              </th>
              <th className="text-right font-semibold px-3 py-2 border-b border-line">{derivedHeader}</th>
              <th className="border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {state.constituents.map((c, idx) => {
              const hint = rowHint(c);
              const d = byToken.get(c.token.trim().toLowerCase());
              const missing = preview?.priceMissing.some((t) => t.toLowerCase() === c.token.trim().toLowerCase());
              // Quantities mode never populates priceMissing; an unpriced token surfaces as a
              // zero-weight/zero-value breakdown row, which should read "—" not "0.0%".
              const qtyNoPrice = !weights && !!d && d.weightBps === 0 && d.valueUsd === "0";
              const derived = !c.token ? "—" : missing ? "no price" : d ? (weights ? d.qty : qtyNoPrice ? "—" : `${(d.weightBps / 100).toFixed(1)}%`) : "—";
              return (
                <tr key={c.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-3 py-2 align-top">
                    <TokenPicker
                      id={`asset-${idx}-token`}
                      value={c.token}
                      onChange={(token) => dispatch({ type: "UPDATE_CONSTITUENT", id: c.id, field: "token", value: token })}
                    />
                    {/* Always rendered (fixed height) so the row doesn't jump as the hint appears/clears. */}
                    <span className={cn("block pl-0.5 mt-0.5 text-[10px] min-h-[13px]", hint?.ok ? "text-emerald" : "text-amber")}>{hint?.text ?? " "}</span>
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <input
                      aria-label={`Asset ${idx + 1} amount`}
                      autoComplete="off"
                      spellCheck={false}
                      className={cn(inputCls, "w-20 text-right")}
                      placeholder="0.00"
                      type="number"
                      min="0"
                      step="any"
                      value={c.amount}
                      onChange={(e) => dispatch({ type: "UPDATE_CONSTITUENT", id: c.id, field: "amount", value: e.target.value })}
                    />
                  </td>
                  <td className={cn("px-3 py-2 text-right align-top font-mono tabular-nums whitespace-nowrap overflow-hidden text-ellipsis", missing ? "text-amber" : "text-txt2")}>{derived}</td>
                  <td className="px-3 py-2 align-top text-right">
                    <button
                      aria-label={`Remove asset ${idx + 1}`}
                      className="w-5 h-5 rounded border border-line bg-surface2 text-txt3 hover:border-red hover:text-red text-xs leading-none"
                      onClick={() => dispatch({ type: "REMOVE_CONSTITUENT", id: c.id })}
                    >×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-3 py-2.5 border-t border-line">
          <Button variant="default" onClick={() => dispatch({ type: "ADD_CONSTITUENT" })}>+ Add asset</Button>
        </div>
      </Module>

      {weights && (
        <>
          <div className={cn("flex items-center gap-2.5 px-3 py-2.5 rounded-lg border", balanced ? "border-emerald/30 bg-emerald/[0.05]" : "border-amber/30 bg-amber/[0.05]")}>
            <span className="text-[11.5px] font-semibold">Total target weight</span>
            <HelpPopover brief="Target weights must total exactly 100%. Deploy stays locked until they do." />
            <span className="flex-1" />
            <span aria-label="weight sum" className="inline-flex items-center gap-2.5">
              <Chip variant={balanced ? "ok" : "bad"}>{balanced ? "balanced" : "off target"}</Chip>
              <span className={cn("font-mono text-lg font-bold tabular-nums", balanced ? "text-emerald" : "text-amber")}>{(Math.round(sum * 10) / 10).toFixed(1)}%</span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-txt3" htmlFor="value-per-unit">
                Value / creation unit ($)
              </label>
              <HelpPopover {...CREATE_HELP.valuePerUnit} />
            </div>
            <input
              id="value-per-unit"
              autoComplete="off"
              spellCheck={false}
              className={cn(inputCls, "w-40")}
              type="number"
              min="0"
              step="any"
              value={state.valuePerUnitUsd}
              onChange={(e) => dispatch({ type: "SET_VALUE_PER_UNIT", value: e.target.value })}
            />
          </div>
        </>
      )}

      <div aria-label="constituent summary" className="text-[11.5px] text-txt2">
        <span className="font-semibold text-txt">{validConstituents(state.constituents).length}</span> constituents
        {hasDuplicateAddresses(state.constituents) && <span className="ml-2 text-amber">⚠ duplicate address</span>}
      </div>

      <div className="flex items-center gap-3 pt-3 border-t border-line">
        <Button variant="default" onClick={onBack}>← Back</Button>
        <span className="flex-1" />
        <Button variant="primary" disabled={!canNext} onClick={onNext}>Next →</Button>
      </div>
    </div>
  );
}
