import type { VaultKind } from "./types";
import { COMPARISON, QUESTIONS } from "./vault-guide";
import { Button } from "../../components/Button";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (kind: VaultKind) => void;
}

const COLS: { key: keyof Omit<(typeof COMPARISON)[number], "attribute">; label: string }[] = [
  { key: "basket", label: "Static" },
  { key: "managed", label: "Managed" },
  { key: "committed", label: "Committed" },
  { key: "rebalance", label: "Rebalanced" },
];

export function HowToChooseModal({ open, onClose, onPick }: Props) {
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
      </div>
    </div>
  );
}
