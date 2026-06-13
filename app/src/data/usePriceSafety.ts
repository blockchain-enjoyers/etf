import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function usePriceSafety(vault: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.constituentPrices(vault),
    queryFn: () => api.getConstituentPrices(vault),
    enabled: enabled && Boolean(vault),
    refetchInterval: 15000,
  });
}
