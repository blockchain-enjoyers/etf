import type { WizardState, WizardAction, ConstituentRow } from "./types";
import { isWeightsMode } from "./types";

export function initialState(): WizardState {
  return {
    step: 1,
    name: "",
    symbol: "",
    vaultKind: "basket",
    constituents: [{ id: crypto.randomUUID(), token: "", amount: "" }],
    creationUnitSize: "1000",
    valuePerUnitUsd: "1000",
    manager: "",
    managerFeeBps: "",
    keeperBps: "1000",
    keeperEscrow: "",
  };
}

export function weightSum(constituents: ConstituentRow[]): number {
  return constituents.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
}

/** Weights mode requires Σ amount == 100 (±0.05). */
export function weightsBalanced(constituents: ConstituentRow[]): boolean {
  return Math.abs(weightSum(constituents) - 100) < 0.05;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export function isAddress(value: string): boolean {
  return ADDRESS_RE.test(value.trim());
}

function hasPositiveAmount(value: string): boolean {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0;
}

export function isRowEmpty(c: ConstituentRow): boolean {
  return c.token.trim().length === 0 && c.amount.trim().length === 0;
}

export function isRowValid(c: ConstituentRow): boolean {
  return isAddress(c.token) && hasPositiveAmount(c.amount);
}

export function hasDuplicateAddresses(constituents: ConstituentRow[]): boolean {
  const seen = new Set<string>();
  for (const c of constituents) {
    if (!isAddress(c.token)) continue;
    const key = c.token.trim().toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function validConstituents(constituents: ConstituentRow[]): ConstituentRow[] {
  return constituents.filter(isRowValid);
}

/**
 * Valid constituents sorted by token address ascending. The on-chain recipe invariant
 * (VaultCore._assertValidRecipe) requires strictly-ascending tokens; preview, deploy, and the
 * schedule-target CTA all map from this order so the resolved unitQty stays index-aligned with tokens.
 */
export function sortedValidConstituents(constituents: ConstituentRow[]): ConstituentRow[] {
  return validConstituents(constituents)
    .slice()
    .sort((a, b) => {
      const ai = BigInt(a.token.trim());
      const bi = BigInt(b.token.trim());
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
}

/** Mode-aware gate for leaving the constituents step. */
export function constituentsOk(state: WizardState): boolean {
  const valid = validConstituents(state.constituents);
  const everyNonEmptyValid = state.constituents.every((c) => isRowEmpty(c) || isRowValid(c));
  const base = valid.length >= 1 && everyNonEmptyValid && !hasDuplicateAddresses(state.constituents);
  if (!isWeightsMode(state.vaultKind)) return base;
  return base && weightsBalanced(state.constituents) && hasPositiveAmount(state.valuePerUnitUsd);
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_NAME":
      return { ...state, name: action.value };
    case "SET_SYMBOL":
      return { ...state, symbol: action.value.toUpperCase().slice(0, 8) };
    case "ADD_CONSTITUENT":
      return { ...state, constituents: [...state.constituents, { id: crypto.randomUUID(), token: "", amount: "" }] };
    case "REMOVE_CONSTITUENT":
      return { ...state, constituents: state.constituents.filter((c) => c.id !== action.id) };
    case "UPDATE_CONSTITUENT":
      return {
        ...state,
        constituents: state.constituents.map((c) =>
          c.id === action.id ? { ...c, [action.field]: action.value } : c,
        ),
      };
    case "SET_VAULT_KIND":
      return { ...state, vaultKind: action.value };
    case "SET_CREATION_UNIT":
      return { ...state, creationUnitSize: action.value };
    case "SET_VALUE_PER_UNIT":
      return { ...state, valuePerUnitUsd: action.value };
    case "GO_STEP":
      return { ...state, step: action.step };
    case "SET_MANAGER":
      return { ...state, manager: action.value };
    case "SET_MANAGER_FEE_BPS":
      return { ...state, managerFeeBps: action.value };
    case "SET_KEEPER_BPS":
      return { ...state, keeperBps: action.value };
    case "SET_KEEPER_ESCROW":
      return { ...state, keeperEscrow: action.value };
    default:
      return state;
  }
}
