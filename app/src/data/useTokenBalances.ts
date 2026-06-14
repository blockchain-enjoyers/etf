import { useQuery } from "@tanstack/react-query";
import type { TokenBalance } from "@meridian/sdk";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

/** Wallet balances + faucet headroom for a set of tokens (drives the in-kind funding check). */
export function useTokenBalances(tokens: string[], account?: string) {
  const api = useApi();
  const norm = [...tokens.map((t) => t.toLowerCase())].sort();
  return useQuery<TokenBalance[]>({
    queryKey: queryKeys.tokenBalances(account ?? "", norm.join(",")),
    queryFn: () => api.getTokenBalances(account!, tokens),
    enabled: Boolean(account) && tokens.length > 0,
    // Balances move when the user faucets or mints — keep it reasonably fresh.
    refetchInterval: 15000,
  });
}
