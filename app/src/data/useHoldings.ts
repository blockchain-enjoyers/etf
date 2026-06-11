import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useHoldings(vaultAddress: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.holdings(vaultAddress),
    queryFn: () => api.getHoldings(vaultAddress),
    enabled: Boolean(vaultAddress),
    refetchInterval: 15000,
  });
}
