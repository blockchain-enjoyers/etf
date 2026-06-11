import { type Chain, defineChain } from "viem";

export interface RhcChainOptions {
  chainId: number;
  rpcUrl?: string;
  multicall3Address: `0x${string}`;
}

/** Robinhood Chain (RHC). viem `defineChain` with multicall3 so batched reads work. [spec §2] */
export function defineRhcChain(opts: RhcChainOptions): Chain {
  const http = opts.rpcUrl ?? "http://127.0.0.1:8545";
  return defineChain({
    id: opts.chainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [http] } },
    contracts: {
      multicall3: { address: opts.multicall3Address },
    },
  });
}
