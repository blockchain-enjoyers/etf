import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useForwardQueue(vaultAddress: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.forwardQueue(vaultAddress),
    queryFn: () => api.getForwardQueue(vaultAddress),
    enabled: enabled && Boolean(vaultAddress),
  });
}
