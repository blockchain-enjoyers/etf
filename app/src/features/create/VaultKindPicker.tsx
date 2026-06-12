import type { VaultKind } from "./types";
import { Chip } from "../../components/Chip";
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
  badge: string;
  whatItIs: string;
  unlocks: string[];
  hasFee: boolean;
}

const CARDS: KindCard[] = [
  { id: "basket", label: "Static", badge: "simplest", whatItIs: "Holds fixed token quantities forever. Weights drift with price. In-kind only, zero fee.", unlocks: ["in-kind mint", "in-kind redeem", "NAV (market hours)"], hasFee: false },
  { id: "managed", label: "Managed", badge: "curated", whatItIs: "Same fixed holdings as Static, plus a capped, timelocked manager fee.", unlocks: ["everything in Static", "manager fee"], hasFee: true },
  { id: "committed", label: "Committed", badge: "advanced", whatItIs: "Static holdings with the recipe committed by hash and passed at mint. For very large baskets.", unlocks: ["in-kind mint", "in-kind redeem"], hasFee: false },
  { id: "rebalance", label: "Rebalanced", badge: "full", whatItIs: "Holds target weights. A keeper trades back to target via auctions when drift exceeds the band.", unlocks: ["target weights", "keeper + auction", "manager fee"], hasFee: true },
  { id: "registry", label: "Registry Index", badge: "SP500", whatItIs: "A large registry-native index (up to 500 names). Cash create/redeem via a forward queue; a keeper rebalances to target weights.", unlocks: ["target weights", "cash create/redeem", "keeper + auction"], hasFee: true },
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
                <span className="flex-1" />
                {card.hasFee && <Chip variant="info">manager fee</Chip>}
                <span className="font-mono text-[8.5px] uppercase tracking-wider text-txt3 border border-line bg-surface3 px-1.5 py-0.5 rounded">{card.badge}</span>
              </div>
              <p className="text-[11px] text-txt2 leading-relaxed">{card.whatItIs}</p>
              <div className="border-t border-line-soft pt-2 mt-auto">
                <div className="text-[8.5px] uppercase tracking-wider text-txt3 mb-1.5">Unlocks</div>
                <ul className="flex flex-wrap gap-1.5 list-none p-0 m-0">
                  {card.unlocks.map((u) => (
                    <li key={u} className="font-mono text-[9.5px] text-txt2 bg-surface3 border border-line rounded px-1.5 py-0.5">{u}</li>
                  ))}
                </ul>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
