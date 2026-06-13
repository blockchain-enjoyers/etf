import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useForwardEnableStatus(vault: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.forwardEnableStatus(vault),
    queryFn: () => api.getForwardEnableStatus(vault),
    enabled: enabled && Boolean(vault),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "pending" || s === "wiring" ? 5000 : false;
    },
  });
}
