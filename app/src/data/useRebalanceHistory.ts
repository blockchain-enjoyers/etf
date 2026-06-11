import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useRebalanceHistory(vaultAddress: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.rebalanceHistory(vaultAddress),
    queryFn: () => api.getRebalanceHistory(vaultAddress),
    enabled: enabled && Boolean(vaultAddress),
  });
}
