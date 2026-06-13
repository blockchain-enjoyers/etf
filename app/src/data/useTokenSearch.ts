import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useTokenSearch(q: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.tokenSearch(q),
    queryFn: () => api.searchTokens(q),
    enabled: q.trim().length >= 1,
    staleTime: 60_000,
  });
}
