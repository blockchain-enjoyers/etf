import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useActivity } from "./useActivity";
import { useToast } from "../components/Toast";

// A forward ticket "resolving" surfaces in the account activity feed as a fill/settle event.
const RESOLVE_KINDS = new Set(["forward-fill", "forward-settle"]);

/**
 * Watches the connected account's activity feed and toasts when a forward ticket resolves (fills at the
 * open price). Baselines on the first load so existing history doesn't toast; only new events fire.
 * Mount once at the app shell.
 */
export function useTicketNotifications(): void {
  const { address } = useAccount();
  const { data: activity } = useActivity(address);
  const { push } = useToast();
  // null = not yet baselined; a Set of seen event keys once we have the initial snapshot.
  const seen = useRef<Set<string> | null>(null);

  // Re-baseline when the account changes (a different wallet's history isn't "new" to notify about).
  useEffect(() => {
    seen.current = null;
  }, [address]);

  useEffect(() => {
    if (!activity) return;
    const resolves = activity.filter((e) => RESOLVE_KINDS.has(e.kind));
    if (seen.current === null) {
      seen.current = new Set(resolves.map((e) => `${e.txHash}:${e.vaultAddress}`));
      return;
    }
    for (const e of resolves) {
      const key = `${e.txHash}:${e.vaultAddress}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      push({
        tone: "ok",
        title: `Forward ticket settled — ${e.symbol}`,
        body: "Your queued order filled at the open price. Shares are in your wallet.",
      });
    }
  }, [activity, push]);
}
