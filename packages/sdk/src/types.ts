// MarketStatus / OracleSource now derive from the Zod schemas in dto.ts (single source of truth).
// Re-exported here for backward compatibility with existing imports from "@meridian/sdk".
export type { MarketStatus, OracleSource } from "./dto.js";
