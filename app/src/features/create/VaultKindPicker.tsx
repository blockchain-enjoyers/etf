import type { VaultKind } from "./types";
import { HelpPopover } from "../../components/HelpPopover";
import { CREATE_HELP } from "./help-content";
import { cn } from "../../lib/cn";

interface Props {
  value: VaultKind;
  onChange: (kind: VaultKind) => void;
}

interface KindCard {
  id: VaultKind;
  label: string;
  blurb: string;
  bestFor: string;
  example: string;
  badges: string[];
}

// Committed is intentionally hidden from the picker (advanced, hash-committed recipe). The VaultKind
// type still carries it; it's just not offered in the wizard.
const CARDS: KindCard[] = [
  {
    id: "basket",
    label: "Static",
    blurb: "A fixed basket that never changes. Publish the holdings once and they stay locked forever. No fee, no rebalancing.",
    bestFor: "A set-and-forget thematic basket.",
    example: "An equal-weight or any fixed thematic basket you never touch.",
    badges: ["Fixed holdings", "No fee", "Stocks in/out"],
  },
  {
    id: "managed",
    label: "Managed fee",
    blurb: "A fixed basket that earns you a fee. The same locked holdings as Static, but you set an annual management fee on the assets.",
    bestFor: "A curated fund you charge for but don't rebalance.",
    example: "A 10-name AI fund at 1%/yr; or any curated thematic fund with an expense ratio.",
    badges: ["Fixed holdings", "Management fee", "Stocks in/out"],
  },
  {
    id: "rebalance",
    label: "Rebalanced",
    blurb: "A basket that keeps its strategy. When the weights drift or the line-up changes, it rebalances back to target automatically. A market maker fills the trade through an auction; you set a fee. Investors enter and exit by depositing the stocks.",
    bestFor: "Rules-based baskets whose weights or members move over time.",
    example: "An equal-weight tech index that resets to equal weight every quarter; or any periodically rebalanced strategy.",
    badges: ["Auto-rebalanced", "Management fee", "Stocks in/out"],
  },
  {
    id: "registry",
    label: "Index fund",
    blurb: "An on-chain index people buy with USDG. A 24/7 NAV prices it at any hour, weekends included. USDG subscriptions and redemptions settle forward, at the market-open NAV, so backing stays honest. A market maker sources or unwinds the basket. Scales to a full index and rebalances automatically.",
    bestFor: "A broad index you want anyone to buy with stablecoins.",
    example: "An S&P 500 or Nasdaq-100 tracker; or any broad market index.",
    badges: ["USDG in/out", "24/7 NAV", "Forward-priced", "Full index"],
  },
];

export function VaultKindPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3" role="radiogroup" aria-label="Vault kind">
      {CARDS.map((card) => {
        const selected = value === card.id;
        return (
          <div key={card.id} className="relative">
            <span className="absolute top-2.5 right-2.5 z-10">
              <HelpPopover {...CREATE_HELP[`kind.${card.id}`]} />
            </span>
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={card.label}
              onClick={() => onChange(card.id)}
              className={cn(
                "w-full h-full text-left border rounded-lg p-3 transition-colors flex flex-col gap-2.5",
                selected ? "border-cyan bg-cyan/[0.05] shadow-[0_0_0_1px_var(--color-cyan-dim)]" : "border-line bg-surface hover:border-txt3 hover:bg-surface2",
              )}
            >
              <div className="flex items-center gap-2 pr-5">
                <span className={cn("w-4 h-4 rounded-full border-2 grid place-items-center shrink-0", selected ? "border-cyan" : "border-line")}>
                  {selected && <span className="w-2 h-2 rounded-full bg-cyan" />}
                </span>
                <span className={cn("text-[12.5px] font-semibold", selected ? "text-cyan" : "text-txt")}>{card.label}</span>
              </div>
              <p className="text-[11px] text-txt2 leading-relaxed">{card.blurb}</p>
              <div className="flex flex-col gap-0.5 text-[10px] leading-relaxed">
                <p className="text-txt2"><span className="text-txt3">Best for: </span>{card.bestFor}</p>
                <p className="text-txt2"><span className="text-txt3">Example: </span>{card.example}</p>
              </div>
              <ul className="flex flex-wrap gap-1.5 list-none p-0 m-0 mt-auto pt-1">
                {card.badges.map((b) => (
                  <li key={b} className="font-mono text-[9.5px] text-txt2 bg-surface3 border border-line rounded px-1.5 py-0.5">{b}</li>
                ))}
              </ul>
            </button>
          </div>
        );
      })}
    </div>
  );
}
