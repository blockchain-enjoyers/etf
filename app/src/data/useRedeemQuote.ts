import { useMutation } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import type { RedeemQuoteRequest } from "@meridian/sdk";

export function useRedeemQuote(vaultAddress: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (req: RedeemQuoteRequest) =>
      api.getRedeemQuote(vaultAddress, req),
  });
}
