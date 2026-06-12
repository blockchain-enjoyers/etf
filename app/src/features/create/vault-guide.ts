import type { VaultKind } from "./types";

/** Short display label per vault kind — shared by the comparison columns and the fund-example badge. */
export const KIND_LABEL: Record<VaultKind, string> = {
  basket: "Static",
  managed: "Managed",
  committed: "Committed",
  rebalance: "Rebalanced",
  registry: "Registry",
};

export interface GuideRow {
  attribute: string;
  basket: string;
  managed: string;
  committed: string;
  rebalance: string;
  registry: string;
}

export const COMPARISON: GuideRow[] = [
  { attribute: "Composition", basket: "Fixed quantities", managed: "Fixed quantities", committed: "Fixed (recipe by hash)", rebalance: "Target weights", registry: "Target weights (≤500)" },
  { attribute: "Rebalancing", basket: "None", managed: "None", committed: "None", rebalance: "Keeper + auctions", registry: "Keeper + auctions" },
  { attribute: "Create / redeem", basket: "In-kind", managed: "In-kind", committed: "In-kind", rebalance: "In-kind + cash", registry: "Cash (forward queue)" },
  { attribute: "Manager fee", basket: "No", managed: "Yes (≤2%/yr)", committed: "No", rebalance: "Yes (≤2%/yr)", registry: "Yes (≤2%/yr)" },
  { attribute: "Keeper", basket: "No", managed: "No", committed: "No", rebalance: "Yes", registry: "Yes" },
  { attribute: "Best for", basket: "Set-and-forget", managed: "Curated buy-and-hold", committed: "Very large baskets", rebalance: "A maintained index", registry: "A large (SP500-style) index" },
  { attribute: "Relative cost", basket: "Lowest", managed: "Low", committed: "Low", rebalance: "Highest", registry: "Highest" },
];

export interface GuideQuestion {
  q: string;
  options: { label: string; kind: VaultKind }[];
}

export const QUESTIONS: GuideQuestion[] = [
  {
    q: "Should the index keep constant proportions over time?",
    options: [
      { label: "Yes — hold target weights", kind: "rebalance" },
      { label: "No — let winners run", kind: "basket" },
    ],
  },
  {
    q: "Do you want to charge a management fee?",
    options: [
      { label: "Yes, a manager fee", kind: "managed" },
      { label: "No fee", kind: "basket" },
    ],
  },
  {
    q: "Is the basket very large (many constituents)?",
    options: [
      { label: "Yes — minimize on-chain storage", kind: "committed" },
      { label: "No — a handful of names", kind: "basket" },
    ],
  },
  {
    q: "Do you need a large index (up to 500 names) with cash create/redeem?",
    options: [
      { label: "Yes — a registry index, cash in/out", kind: "registry" },
      { label: "No — in-kind is fine", kind: "rebalance" },
    ],
  },
];
