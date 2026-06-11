import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useAuctionStatus(vaultAddress: string, account?: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.auctionStatus(vaultAddress, account),
    queryFn: () => api.getAuctionStatus(vaultAddress, account),
    enabled: Boolean(vaultAddress),
    refetchInterval: 15000,
  });
}
