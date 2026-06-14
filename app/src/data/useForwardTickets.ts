import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useForwardTickets(vaultAddress: string, owner: string | undefined, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...queryKeys.forwardTickets(vaultAddress), owner ?? "all"],
    queryFn: () => api.getForwardTickets(vaultAddress, owner),
    enabled: enabled && Boolean(vaultAddress),
    // Tickets change off-screen (keeper settles, cutoffs pass) — poll like the account/activity feeds.
    refetchInterval: 15000,
  });
}
