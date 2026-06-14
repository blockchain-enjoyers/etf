import { useSettleGateStatus } from "./useSettleGateStatus";

/**
 * Registry bootstrap state from the settle gate's g0 guard ("Vault bootstrapped"). A registry index
 * is created empty and must be seeded with its genesis basket before any cash/AP flow works.
 * `loaded` guards against banner flicker before the gate resolves; non-registry vaults read as
 * bootstrapped (no genesis step).
 */
export function useRegistryBootstrap(vaultAddress: string, isRegistry: boolean): { loaded: boolean; bootstrapped: boolean } {
  const { data } = useSettleGateStatus(vaultAddress, isRegistry);
  if (!isRegistry) return { loaded: true, bootstrapped: true };
  const g0 = data?.guards.find((g) => g.id === "g0");
  return { loaded: g0 != null, bootstrapped: g0 ? g0.ok : true };
}
