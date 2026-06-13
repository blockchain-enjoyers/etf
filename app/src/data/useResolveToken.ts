import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

const ADDR = /^0x[0-9a-fA-F]{40}$/;

export function useResolveToken(address: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.tokenResolve(address.toLowerCase()),
    queryFn: async () => (await api.resolveTokens([address]))[0] ?? null,
    enabled: ADDR.test(address),
    staleTime: 60_000,
  });
}
