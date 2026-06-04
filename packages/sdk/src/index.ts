// @meridian/sdk — wraps the backend API + on-chain reads. The API DTO types live here;
// the backend type-imports them so there is no DTO duplication (see spec §3).
import type { MarketStatus, OracleSource } from "./types.js";

export * from "./types.js";

// --- API DTOs (request/response shapes the backend serves and the frontend consumes) ---
export interface NavResponse {
  basketId: string;
  nav: string; // 18-dec USD as decimal string
  confidenceLower: string;
  confidenceUpper: string;
  marketStatus: MarketStatus;
  estimated: boolean; // IRON RULE: true => never a settlement price
  source: OracleSource;
  timestampMs: number;
}

export interface SdkConfig {
  apiBaseUrl: string;
  chainId: number;
}

export class MeridianClient {
  constructor(private readonly config: SdkConfig) {}

  async getNav(basketId: string): Promise<NavResponse> {
    const res = await fetch(`${this.config.apiBaseUrl}/baskets/${basketId}/nav`);
    if (!res.ok) throw new Error(`getNav failed: ${res.status}`);
    return (await res.json()) as NavResponse;
  }
}
