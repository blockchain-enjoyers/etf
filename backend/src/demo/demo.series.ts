import type { DemoSeries } from "@meridian/sdk";

/**
 * Static V0 demo series (spec §7 `GET /demo/:id`). Each illustrates a scenario from the
 * contract matrix (spec §7) as a NAV frame sequence. Pure data — no chain, no wallet.
 */
export const DEMO_SERIES: readonly DemoSeries[] = [
  {
    id: "weekend-gap",
    event: "weekend-stale",
    name: "Weekend Gap (closed-market estimate, band widens)",
    frames: [
      { t: 0, v: "100.00" },
      { t: 1, v: "100.00" },
      { t: 2, v: "100.00" },
      { t: 3, v: "101.25" },
    ],
  },
  {
    id: "halt-recovery",
    event: "halt",
    name: "Trading Halt then Resume",
    frames: [
      { t: 0, v: "50.00" },
      { t: 1, v: "50.00" },
      { t: 2, v: "48.10" },
    ],
  },
  {
    id: "forward-settle",
    event: "forward-settle",
    name: "Forward-priced settlement at next open",
    frames: [
      { t: 0, v: "10.00" },
      { t: 1, v: "10.40" },
    ],
  },
] as const;
