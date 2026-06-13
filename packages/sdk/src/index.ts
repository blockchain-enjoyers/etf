export * from "./types.js";
export * from "./dto.js";
export * from "./price-safety.js";
export * from "./eip712.js";
export * from "./errors.js";
export * from "./tx-guard.js";
export type { MeridianApi } from "./api.js";
export { MeridianClient } from "./client.js";
export type { MeridianClientConfig } from "./client.js";

export interface SdkConfig {
  apiBaseUrl: string;
  chainId: number;
}
