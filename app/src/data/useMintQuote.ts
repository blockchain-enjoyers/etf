import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useMintQuote(vaultAddress: string, units: string, account?: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.mintQuote(vaultAddress, units, account),
    queryFn: () => api.getMintQuote(vaultAddress, { units, account }),
    enabled:
      Boolean(vaultAddress) &&
      (() => {
        try {
          return BigInt(units || "0") > 0n;
        } catch {
          return false;
        }
      })(),
  });
}
