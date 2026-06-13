import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useSettleGateStatus(vaultAddress: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.forwardGate(vaultAddress),
    queryFn: () => api.getSettleGateStatus(vaultAddress),
    enabled: enabled && Boolean(vaultAddress),
    // Gate is live on-chain state (observer prints age, market opens/closes) — poll like NAV.
    refetchInterval: 15000,
  });
}
