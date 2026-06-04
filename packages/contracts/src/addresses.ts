// Per-chain deployment addresses. Filled in as deployments land.
export const CHAIN_IDS = {
  robinhoodChainTestnet: 46630,
  arbitrumSepolia: 421614,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

// role/contract -> address per chain. Empty until deployment.
export const addresses: Record<ChainId, Record<string, `0x${string}`>> = {
  [CHAIN_IDS.robinhoodChainTestnet]: {},
  [CHAIN_IDS.arbitrumSepolia]: {},
};
