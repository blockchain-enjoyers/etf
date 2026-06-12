import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

/** Static reference catalog for the create-flow recommender; rarely changes, so cache it long. */
export function useSuggestedFunds() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.suggestedFunds,
    queryFn: () => api.getSuggestedFunds(),
    staleTime: 60 * 60_000,
  });
}
