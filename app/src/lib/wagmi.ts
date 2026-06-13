import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { createConfig, http, type Config } from "wagmi";
import { mock } from "wagmi/connectors";

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

/** Fully-mocked fixtures mode: fake auto-connected wallet, no chain/RPC. */
export const FIXTURES = import.meta.env.VITE_USE_FIXTURES === "true";
/** Demo address shown when connected in fixtures mode. */
export const MOCK_ACCOUNT =
  "0xb1Ce525A223DB37BbbC5636D1dd70f7bfeF6e3cD" as const;

function buildConfig(): Config {
  if (FIXTURES) {
    return createConfig({
      chains: appChains,
      connectors: [
        mock({
          accounts: [MOCK_ACCOUNT],
          features: { defaultConnected: true },
        }),
      ],
      transports: { [robinhoodChainTestnet.id]: http() },
    });
  }
  return getDefaultConfig({
    appName: "Meridian",
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "",
    chains: appChains,
  });
}

// Lazy singleton: building the config eagerly at module load would force
// getDefaultConfig()/createConfig() to run merely on importing a constant like
// FIXTURES/APP_CHAIN_ID — which breaks unit tests that partially `vi.mock("wagmi")`.
// Only main.tsx calls this (the real app), where wagmi's exports are present.
let _config: Config | undefined;
export function getWagmiConfig(): Config {
  return (_config ??= buildConfig());
}
