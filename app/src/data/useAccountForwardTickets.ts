import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

/** OPEN forward-queue tickets for the connected account across all vaults (Portfolio pending section). */
export function useAccountForwardTickets(account: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.accountForwardTickets(account ?? ""),
    queryFn: () => api.getAccountForwardTickets(account!),
    enabled: Boolean(account),
    refetchInterval: 15000,
  });
}
