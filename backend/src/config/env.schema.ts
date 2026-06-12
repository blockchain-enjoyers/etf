import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  RHC_RPC_URL: z.string().url().optional(),
  CHAIN_ID: z.coerce.number().int().positive().default(46630),
  // Block to backfill the indexer from on a fresh checkpoint (e.g. the CloneFactory deploy block).
  // 0 = no backfill (start at head-1, the prior behavior).
  INDEXER_START_BLOCK: z.coerce.number().int().nonnegative().default(0),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  BOOTSTRAP_BASKET_ID: z.string().optional(),

  // --- Suggested-funds catalog (create-flow recommender) ---
  // Path to the tools/registry artifact. Optional: resolved against a set of repo-relative candidates
  // when unset, so it works from both src (dev/test) and dist/ (prod).
  SUGGESTED_FUNDS_PATH: z.string().optional(),
  // JSON array of lowercased token addresses that actually exist on the target chain. A catalog
  // constituent is "resolvable" (→ wizard pre-fill) only if its address is in this set. Empty on
  // testnet (only ~5 demo tokens), so funds are reference-only there.
  SUGGESTED_FUNDS_TOKENS: z.string().default("[]"),

  // --- Chain (Plan B) ---
  MULTICALL3_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default("0xcA11bde05977b3631167028862bE2a173976CA11"),
  KEEPER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),

  // --- Signals (Plan B) ---
  CHAINLINK_DS_API_URL: z.string().url().default("https://api.dataengine.chain.link"),
  CHAINLINK_DS_API_KEY: z.string().optional(),
  CHAINLINK_DS_API_SECRET: z.string().optional(),
  PYTH_HERMES_URL: z.string().url().default("https://hermes.pyth.network"),
  // JSON map { "<lowercased token address>": "<pyth price id>" } for real equity feeds.
  PYTH_PRICE_IDS: z.string().default("{}"),
  SIGNAL_STALE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(120),
  SEQUENCER_GRACE_PERIOD_SECONDS: z.coerce.number().int().nonnegative().default(3600),
  ESTIMATED_BAND_BPS: z.coerce.number().int().nonnegative().default(200),
  SIGNAL_MAX_DIVERGENCE_BPS: z.coerce.number().int().positive().default(100),
  FV_MAX_DRIFT_BPS: z.coerce.number().int().nonnegative().default(50),

  // --- Keeper ---
  KEEPER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  ORACLE_PUSH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  NAV_SOURCE: z.enum(["onchain", "offchain"]).default("offchain"),

  // Testnet demo only: force the weekday price leg live so Open (non-estimated) NAV + forward settle
  // are verifiable outside US market hours. Default false ⇒ honest wall-clock gating (iron rule).
  MARKET_FORCE_OPEN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // JSON map { "<vaultAddress>": "<forwardQueueAddress>" }. Empty until L5 is deployed.
  FORWARD_QUEUES: z.string().default("{}"),
  FORWARD_OPERATOR_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  FORWARD_OPERATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  FORWARD_AP_FILLER_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Parse + validate. Throws a flattened, readable error on failure (fail-fast at boot). */
export function parseEnv(source: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
