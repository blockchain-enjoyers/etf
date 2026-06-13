import "@rainbow-me/rainbowkit/styles.css";
import "./app.css";

import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider, useAccount, useConnect } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { RouterProvider } from "react-router-dom";

import { getWagmiConfig, FIXTURES } from "./lib/wagmi";
import { makeQueryClient } from "./lib/query";
import { ApiProvider } from "./lib/api";
import { router } from "./routes/router";

const queryClient = makeQueryClient();

/** Fixtures mode: auto-connect the mock connector so the UI is connected without a click. */
function FixturesAutoConnect() {
  const { connect, connectors } = useConnect();
  const { isConnected } = useAccount();
  useEffect(() => {
    if (FIXTURES && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [connect, connectors, isConnected]);
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={getWagmiConfig()}>
      <QueryClientProvider client={queryClient}>
        <FixturesAutoConnect />
        <RainbowKitProvider theme={darkTheme({ accentColor: "#35d0e0", borderRadius: "small" })}>
          <ApiProvider>
            <RouterProvider router={router} />
          </ApiProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
