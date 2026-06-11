import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import type { Config } from "wagmi";

export const robinhoodChainTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        import.meta.env.VITE_RPC_46630 ??
          "https://rpc.robinhood-testnet.example",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

/** The single home chain. Any other wallet network shows RainbowKit's "Wrong network" → switch. */
export const APP_CHAIN_ID = robinhoodChainTestnet.id;
export const appChains = [robinhoodChainTestnet] as const;

export const wagmiConfig: Config = getDefaultConfig({
  appName: "Meridian",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "",
  chains: appChains,
});
