import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useForwardHistory(vaultAddress: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.forwardHistory(vaultAddress),
    queryFn: () => api.getForwardHistory(vaultAddress),
    enabled: enabled && Boolean(vaultAddress),
  });
}
