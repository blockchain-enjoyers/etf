import { QueryClient } from "@tanstack/react-query";

export const queryKeys = {
  feed: ["feed"] as const,
  baskets: ["baskets"] as const,
  basket: (vaultAddress: string) => ["basket", vaultAddress] as const,
  nav: (vaultAddress: string) => ["nav", vaultAddress] as const,
  history: (vaultAddress: string, range: string) =>
    ["history", vaultAddress, range] as const,
  premium: (vaultAddress: string) => ["premium", vaultAddress] as const,
  rebalance: (vaultAddress: string) => ["rebalance", vaultAddress] as const,
  keeper: (vaultAddress: string) => ["keeper", vaultAddress] as const,
  rebalanceHistory: (vaultAddress: string) => ["rebalanceHistory", vaultAddress] as const,
  forwardTickets: (vaultAddress: string) => ["forwardTickets", vaultAddress] as const,
  forwardQueue: (vaultAddress: string) => ["forwardQueue", vaultAddress] as const,
  forwardGate: (vaultAddress: string) => ["forwardGate", vaultAddress] as const,
  forwardEnableStatus: (vaultAddress: string) => ["forwardEnableStatus", vaultAddress] as const,
  forwardHistory: (vaultAddress: string) => ["forwardHistory", vaultAddress] as const,
  holdings: (vault: string) => ["holdings", vault] as const,
  accountHoldings: (account: string) => ["accountHoldings", account] as const,
  accountForwardTickets: (account: string) => ["accountForwardTickets", account] as const,
  activity: (account: string) => ["activity", account] as const,
  availability: (vault: string, account?: string) => ["availability", vault, account ?? null] as const,
  auctionStatus: (vault: string, account?: string) => ["auctionStatus", vault, account ?? null] as const,
  mintQuote: (vault: string, units: string, account?: string) => ["mintQuote", vault, units, account ?? null] as const,
  constituentPrices: (v: string) => ["constituentPrices", v] as const,
  deployPreview: (key: string) => ["deployPreview", key] as const,
  suggestedFunds: ["suggestedFunds"] as const,
  tokenSearch: (q: string) => ["tokenSearch", q] as const,
  tokenResolve: (addr: string) => ["tokenResolve", addr] as const,
  tokenBalances: (account: string, tokens: string) => ["tokenBalances", account, tokens] as const,
};

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
