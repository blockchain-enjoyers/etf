import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.schema.js";

describe("parseEnv", () => {
  it("parses a valid environment", () => {
    const env = parseEnv({
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      PORT: "3000",
      CHAIN_ID: "46630",
      RHC_RPC_URL: "https://rpc.example",
      NODE_ENV: "test",
      LOG_LEVEL: "info",
    });
    expect(env.PORT).toBe(3000);
    expect(env.CHAIN_ID).toBe(46630);
    expect(env.NODE_ENV).toBe("test");
  });

  it("throws a descriptive error when DATABASE_URL is missing", () => {
    expect(() => parseEnv({ PORT: "3000" })).toThrowError(/DATABASE_URL/);
  });

  it("coerces numeric PORT and rejects non-numeric", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgresql://x", PORT: "abc" })).toThrow();
  });

  it("NAV_SOURCE defaults to offchain", () => {
    expect(parseEnv({ DATABASE_URL: "x" }).NAV_SOURCE).toBe("offchain");
  });

  it("NAV_SOURCE accepts onchain", () => {
    expect(parseEnv({ DATABASE_URL: "x", NAV_SOURCE: "onchain" }).NAV_SOURCE).toBe("onchain");
  });
});
