import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useNav(vaultAddress: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.nav(vaultAddress),
    queryFn: () => api.getNav(vaultAddress),
    enabled: Boolean(vaultAddress),
    refetchInterval: 15000,
  });
}
