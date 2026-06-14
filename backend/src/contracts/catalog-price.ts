import { parseUnits } from "viem";
import { demoTokens } from "@meridian/contracts";

// Baseline 18-dec USD price for every demo-catalog token. These stocks have no live oracle feed and
// no PriceSnapshot until they belong to an indexed vault, so the catalog seeds an initial anchor the
// rest of the pipeline (preview, last-close walk, NAV) builds on. Off-catalog tokens stay undefined.
const CATALOG = new Map<string, bigint>(
  demoTokens.map((t) => [t.address.toLowerCase(), parseUnits(t.priceUsd.toFixed(6), 18)]),
);

/** 18-dec USD baseline price for a demo-catalog token, or undefined for anything off-catalog. */
export function catalogPrice18(token: string): bigint | undefined {
  return CATALOG.get(token.toLowerCase());
}
