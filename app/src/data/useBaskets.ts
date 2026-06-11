import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

export function useBaskets() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.baskets,
    queryFn: () => api.listBaskets(),
  });
}
