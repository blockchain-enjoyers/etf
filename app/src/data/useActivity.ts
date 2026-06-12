import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

/** Per-account activity feed (mint/redeem + forward lifecycle), newest first. */
export function useActivity(account: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.activity(account ?? ""),
    queryFn: () => api.getAccountActivity(account!),
    enabled: Boolean(account),
    refetchInterval: 15000,
  });
}
