import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useBasket(vaultAddress: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.basket(vaultAddress),
    queryFn: () => api.getBasket(vaultAddress),
    enabled: Boolean(vaultAddress),
  });
}
