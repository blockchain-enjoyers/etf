import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useKeeperStatus(vaultAddress: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.keeper(vaultAddress),
    queryFn: () => api.getKeeperStatus(vaultAddress),
    enabled: enabled && Boolean(vaultAddress),
  });
}
