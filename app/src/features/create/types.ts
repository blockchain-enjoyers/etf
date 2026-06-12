export type VaultKind = "basket" | "managed" | "committed" | "rebalance" | "registry";

/** Rebalance & registry vaults are defined by target weights; every other kind by literal per-unit quantities. */
export const isWeightsMode = (k: VaultKind): boolean => k === "rebalance" || k === "registry";

/** Kinds that carry the manager/keeper settings + manager-fee disclosure (rebalance-style economics). */
export const isManagedRebalance = (k: VaultKind): boolean => k === "rebalance" || k === "registry";

export interface ConstituentRow {
  id: string;
  token: string;
  /** Quantities mode: tokens per creation unit. Weights mode: target % (0–100). */
  amount: string;
}

export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5;
  name: string;
  symbol: string;
  vaultKind: VaultKind;
  constituents: ConstituentRow[];
  creationUnitSize: string; // shares per creation unit (unitSize); all kinds
  valuePerUnitUsd: string;  // weights mode only — USD notional used to derive unitQty
  manager: string;          // managed/rebalance
  managerFeeBps: string;    // managed/rebalance
  keeperBps: string;        // rebalance
  keeperEscrow: string;     // rebalance
}

export type WizardAction =
  | { type: "SET_NAME"; value: string }
  | { type: "SET_SYMBOL"; value: string }
  | { type: "ADD_CONSTITUENT" }
  | { type: "REMOVE_CONSTITUENT"; id: string }
  | { type: "UPDATE_CONSTITUENT"; id: string; field: "token" | "amount"; value: string }
  | { type: "SET_VAULT_KIND"; value: VaultKind }
  | { type: "LOAD_TEMPLATE"; vaultKind: VaultKind; rows: { token: string; amount: string }[] }
  | { type: "SET_CREATION_UNIT"; value: string }
  | { type: "SET_VALUE_PER_UNIT"; value: string }
  | { type: "GO_STEP"; step: WizardState["step"] }
  | { type: "SET_MANAGER"; value: string }
  | { type: "SET_MANAGER_FEE_BPS"; value: string }
  | { type: "SET_KEEPER_BPS"; value: string }
  | { type: "SET_KEEPER_ESCROW"; value: string };
