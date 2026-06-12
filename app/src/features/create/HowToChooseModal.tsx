import type { VaultKind } from "./types";
import type { SuggestedFund, SuggestedResolvableToken } from "@meridian/sdk";
import { COMPARISON, QUESTIONS, KIND_LABEL } from "./vault-guide";
import { Button } from "../../components/Button";
import { useSuggestedFunds } from "../../data/useSuggestedFunds";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (kind: VaultKind) => void;
  /** Optional: pre-fill the wizard from a suggested fund whose holdings resolve on-chain. */
  onUseTemplate?: (vaultKind: VaultKind, rows: { token: string; amount: string }[]) => void;
}

const COLS: { key: keyof Omit<(typeof COMPARISON)[number], "attribute">; label: string }[] = [
  { key: "basket", label: "Static" },
  { key: "managed", label: "Managed" },
  { key: "committed", label: "Committed" },
  { key: "rebalance", label: "Rebalanced" },
  { key: "registry", label: "Registry" },
];

/**
 * Build wizard constituent rows from a fund's resolvable tokens: renormalize their weights to
 * percentages summing to 100 (2dp). Weights mode reads `amount` as a target %, quantities mode as a
 * relative starting quantity — either way it's a sensible, user-editable starting point.
 */
export function templateRows(tokens: SuggestedResolvableToken[]): { token: string; amount: string }[] {
  const total = tokens.reduce((acc, t) => acc + t.weightBps, 0);
  if (total <= 0) return tokens.map((t) => ({ token: t.token, amount: "" }));
  return tokens.map((t) => ({ token: t.token, amount: ((t.weightBps / total) * 100).toFixed(2) }));
}

function KindBadge({ kind }: { kind: VaultKind }) {
  return (
    <span className="font-mono text-[8.5px] uppercase tracking-wider text-cyan border border-cyan/40 bg-cyan/[0.06] px-1.5 py-0.5 rounded">
      {KIND_LABEL[kind]}
    </span>
  );
}

function FundCard({
  fund,
  onUseTemplate,
  onClose,
}: {
  fund: SuggestedFund;
  onUseTemplate?: Props["onUseTemplate"];
  onClose: () => void;
}) {
  const canPrefill = onUseTemplate != null && fund.resolvableTokens.length > 0;
  const more = fund.holdingsCount - fund.sampleHoldings.length;
  return (
    <div className="border border-line rounded-md bg-surface2 p-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-txt truncate">{fund.name}</span>
        <KindBadge kind={fund.recommendedVaultKind} />
        <span className="flex-1" />
        <span className="text-[9px] uppercase tracking-wider text-txt3">{fund.category}</span>
      </div>
      <p className="text-[10.5px] text-txt2 leading-snug">{fund.description}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {fund.sampleHoldings.map((h) => (
          <span key={`${fund.id}-${h.symbol}`} className="font-mono text-[9.5px] text-txt2 bg-surface3 border border-line rounded px-1.5 py-0.5">
            {h.symbol} {(h.weightBps / 100).toFixed(1)}%
          </span>
        ))}
        {more > 0 && <span className="font-mono text-[9.5px] text-txt3">+{more} more</span>}
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        {canPrefill ? (
          <Button
            variant="default"
            className="text-[11px] px-2 py-1"
            onClick={() => {
              onUseTemplate?.(fund.recommendedVaultKind, templateRows(fund.resolvableTokens));
              onClose();
            }}
          >
            Use as starting point
          </Button>
        ) : (
          <span className="text-[9.5px] text-txt3 italic">Reference only — its tokens aren’t on this network.</span>
        )}
      </div>
    </div>
  );
}

export function HowToChooseModal({ open, onClose, onPick, onUseTemplate }: Props) {
  const funds = useSuggestedFunds();
  if (!open) return null;
  const pick = (k: VaultKind) => { onPick(k); onClose(); };
  return (
    <div role="dialog" aria-modal="true" aria-label="How to choose a vault type" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-w-2xl w-full max-h-[85vh] overflow-auto border border-line rounded-lg bg-surface p-4 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h3 className="text-sm font-bold">How do I choose?</h3>
          <span className="flex-1" />
          <button aria-label="Close" className="text-txt3 hover:text-txt" onClick={onClose}>✕</button>
        </div>

        <div className="flex flex-col gap-3">
          {QUESTIONS.map((qq) => (
            <div key={qq.q} className="flex flex-col gap-1.5">
              <p className="text-[12px] text-txt">{qq.q}</p>
              <div className="flex flex-wrap gap-2">
                {qq.options.map((o) => (
                  <Button key={o.label} variant="default" onClick={() => pick(o.kind)}>{o.label}</Button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-txt3">
              <th className="text-left py-1.5 pr-3 border-b border-line font-semibold">Attribute</th>
              {COLS.map((c) => <th key={c.key} className="text-left py-1.5 pr-3 border-b border-line font-semibold">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((r) => (
              <tr key={r.attribute} className="border-b border-line-soft">
                <td className="py-1.5 pr-3 text-txt2">{r.attribute}</td>
                {COLS.map((c) => <td key={c.key} className="py-1.5 pr-3 text-txt font-mono">{r[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>

        <section className="flex flex-col gap-2" aria-label="Fund examples">
          <div className="flex items-baseline gap-2">
            <h4 className="text-[12px] font-bold">Fund examples</h4>
            <span className="text-[10px] text-txt3">Real-ETF replicas and the vault type that fits each.</span>
          </div>
          {funds.isLoading && <p className="text-[11px] text-txt3">Loading examples…</p>}
          {funds.isError && <p className="text-[11px] text-txt3">Examples are unavailable right now.</p>}
          {funds.data && funds.data.funds.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {funds.data.funds.map((f) => (
                <FundCard key={f.id} fund={f} onUseTemplate={onUseTemplate} onClose={onClose} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
