import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useFeed() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.feed,
    queryFn: () => api.getFeed(),
    refetchInterval: 15000,
  });
}
