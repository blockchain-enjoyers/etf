import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PreviewDeployRequest } from "@meridian/sdk";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";

/** Returns `value` delayed by `delayMs`, so rapid edits collapse into one settled value. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function useDeployPreview(req: PreviewDeployRequest) {
  const api = useApi();
  // Debounce on the serialized request so per-keystroke edits don't each POST /tx/preview-deploy.
  const key = JSON.stringify(req);
  const debouncedKey = useDebouncedValue(key, 300);
  const debounced = JSON.parse(debouncedKey) as PreviewDeployRequest;
  return useQuery({
    queryKey: queryKeys.deployPreview(debouncedKey),
    queryFn: () => api.previewDeploy(debounced),
    enabled: debounced.tokens.length > 0 && Boolean(debounced.account),
  });
}
