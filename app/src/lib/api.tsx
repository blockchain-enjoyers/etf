import { createContext, useContext, type ReactNode } from "react";
import { MeridianClient } from "@meridian/sdk";
import type { MeridianApi } from "@meridian/sdk";
import { FixtureApi } from "../fixtures/fixture-api";

export const ApiContext = createContext<MeridianApi | null>(null);

function buildApi(): MeridianApi {
  if (import.meta.env.VITE_USE_FIXTURES === "true") {
    return new FixtureApi();
  }
  return new MeridianClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? "" });
}

const defaultApi = buildApi();

export function ApiProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: MeridianApi;
}) {
  return <ApiContext.Provider value={value ?? defaultApi}>{children}</ApiContext.Provider>;
}

export function useApi(): MeridianApi {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used inside <ApiProvider>");
  return ctx;
}
