import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function usePremiumDiscount(vaultAddress: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.premium(vaultAddress),
    queryFn: () => api.getPremiumDiscount(vaultAddress),
    enabled: Boolean(vaultAddress),
  });
}
