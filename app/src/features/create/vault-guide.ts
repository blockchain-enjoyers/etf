import type { VaultKind } from "./types";

export interface GuideRow {
  attribute: string;
  basket: string;
  managed: string;
  committed: string;
  rebalance: string;
}

export const COMPARISON: GuideRow[] = [
  { attribute: "Composition", basket: "Fixed quantities", managed: "Fixed quantities", committed: "Fixed (recipe by hash)", rebalance: "Target weights" },
  { attribute: "Rebalancing", basket: "None", managed: "None", committed: "None", rebalance: "Keeper + auctions" },
  { attribute: "Manager fee", basket: "No", managed: "Yes (≤2%/yr)", committed: "No", rebalance: "Yes (≤2%/yr)" },
  { attribute: "Keeper", basket: "No", managed: "No", committed: "No", rebalance: "Yes" },
  { attribute: "Best for", basket: "Set-and-forget", managed: "Curated buy-and-hold", committed: "Very large baskets", rebalance: "A maintained index" },
  { attribute: "Relative cost", basket: "Lowest", managed: "Low", committed: "Low", rebalance: "Highest" },
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
];
