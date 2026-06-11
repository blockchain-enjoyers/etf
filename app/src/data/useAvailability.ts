import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useAvailability(vaultAddress: string, account?: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.availability(vaultAddress, account),
    queryFn: () => api.getAvailability(vaultAddress, account),
    enabled: Boolean(vaultAddress),
    refetchInterval: 15000,
  });
}
