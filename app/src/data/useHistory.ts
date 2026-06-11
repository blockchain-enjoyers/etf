import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";
import type { HistoryQuery } from "@meridian/sdk";

export function useHistory(vaultAddress: string, range: HistoryQuery["range"]) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.history(vaultAddress, range),
    queryFn: () => api.getHistory(vaultAddress, range),
    enabled: Boolean(vaultAddress),
  });
}
