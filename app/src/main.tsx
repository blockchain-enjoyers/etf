import "@rainbow-me/rainbowkit/styles.css";
import "./app.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { RouterProvider } from "react-router-dom";

import { wagmiConfig } from "./lib/wagmi";
import { makeQueryClient } from "./lib/query";
import { ApiProvider } from "./lib/api";
import { router } from "./routes/router";

const queryClient = makeQueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: "#35d0e0", borderRadius: "small" })}>
          <ApiProvider>
            <RouterProvider router={router} />
          </ApiProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
