import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useAccountHoldings(account: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.accountHoldings(account ?? ""),
    queryFn: () => api.getAccountHoldings(account!),
    enabled: Boolean(account),
    refetchInterval: 15000,
  });
}
