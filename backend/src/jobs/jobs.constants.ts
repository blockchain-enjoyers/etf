/** Producer job names (spec §3, §5). */
export const JOB_SIGNAL_POLL = "signal-poll" as const;
export const JOB_NAV_COMPUTE = "nav-compute" as const;
export const JOB_INDEXER_TICK = "indexer-tick" as const;
export const JOB_TWAP_RECORD = "twap-record" as const;
export const JOB_FORWARD_ENABLE = "forward-enable" as const;

/** Postgres LISTEN/NOTIFY channel for cross-replica SSE fan-out. */
export const NAV_UPDATE_CHANNEL = "nav_update" as const;

/** Dedicated pg-boss schema — kept separate from the Prisma-managed `public` schema (spec §6). */
export const PGBOSS_SCHEMA = "pgboss" as const;

/** Cron cadences (UTC). Tight enough for a live NAV stream, gentle on the chain RPC. */
export const CRON_SIGNAL_POLL = "*/15 * * * * *" as const; // every 15s (6-field: seconds)
export const CRON_NAV_COMPUTE = "*/30 * * * * *" as const; // every 30s
export const CRON_INDEXER_TICK = "*/20 * * * * *" as const; // every 20s
export const CRON_TWAP_RECORD = "0 */5 * * * *" as const; // every 5 min

/** NOTIFY payload contract: which snapshot to read for the SSE push. */
export interface NavUpdatePayload {
  vaultAddress: string;
  navSnapshotId: string;
}
