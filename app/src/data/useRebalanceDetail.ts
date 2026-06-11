import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useRebalanceDetail(vaultAddress: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.rebalance(vaultAddress),
    queryFn: () => api.getRebalanceDetail(vaultAddress),
    enabled: enabled && Boolean(vaultAddress),
  });
}
