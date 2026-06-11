import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../lib/api";
import { MeridianClient } from "@meridian/sdk";

export const TEST_BASE_URL = "http://test.local";

export function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const client = new MeridianClient({ baseUrl: TEST_BASE_URL });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
      </QueryClientProvider>
    );
  }

  return { Wrapper, queryClient };
}
