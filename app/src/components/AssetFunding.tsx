import { useQueryClient } from "@tanstack/react-query";
import { useApi } from "../lib/api";
import { queryKeys } from "../lib/query";
import { useTokenBalances } from "../data/useTokenBalances";
import { useTxPlan } from "../wallet/use-tx-plan";
import { Button } from "./Button";
import { formatQty, shortenAddress } from "../lib/format";

export interface RequiredAsset {
  token: string;
  symbol?: string;
  /** Base-unit amount the action will pull for this token. */
  amount: string;
}

function toBig(v: string): bigint {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

/**
 * In-kind funding check: compares the connected wallet's balance of each required underlying against
 * the amount the action will pull, and for any shortfall on a demo Stock offers a one-click faucet
 * mint. Renders nothing when every constituent is sufficiently funded (or no wallet/requirements).
 */
export function AssetFunding({ required, account }: { required: RequiredAsset[]; account?: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const tokens = required.map((r) => r.token);
  const { data: balances } = useTokenBalances(tokens, account);
  const tx = useTxPlan(tokens);
  const running = tx.status === "running";

  if (!account || required.length === 0 || !balances) return null;

  const byToken = new Map(balances.map((b) => [b.token.toLowerCase(), b]));
  const short = required
    .map((r) => {
      const bal = byToken.get(r.token.toLowerCase());
      return { req: r, bal, have: bal ? toBig(bal.balance) : 0n, need: toBig(r.amount) };
    })
    .filter((r) => r.need > r.have);

  if (short.length === 0) return null;

  function faucet(token: string) {
    if (!account) return;
    void tx
      .run(() => api.buildFaucetTx(token, { account }))
      .then(() => qc.invalidateQueries({ queryKey: ["tokenBalances", account] }));
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber/30 bg-amber/[0.06] px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber">
        <span aria-hidden>⚠</span> Not enough underlying to mint
      </div>
      <p className="text-[10.5px] text-txt3 leading-relaxed">
        You hold less of these than the deposit needs. Mint test tokens to top up, then submit.
      </p>
      <div className="flex flex-col gap-1.5">
        {short.map(({ req, bal, have, need }) => {
          const canFaucet = bal?.faucetAmount != null && toBig(bal.faucetRemaining ?? "0") > 0n;
          const sym = req.symbol ?? bal?.symbol ?? shortenAddress(req.token);
          return (
            <div key={req.token} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono text-txt">{sym}</span>
              <span className="font-mono text-txt3">
                have {formatQty(have.toString())} / need {formatQty(need.toString())}
              </span>
              <span className="flex-1" />
              {canFaucet ? (
                <Button
                  variant="default"
                  onClick={() => faucet(req.token)}
                  disabled={running}
                  aria-label={`Mint test ${sym}`}
                  className="py-1 px-2 text-[10.5px]"
                >
                  {running ? "Minting…" : `Mint ${formatQty(bal!.faucetAmount!)}`}
                </Button>
              ) : (
                <span className="font-mono text-[10px] text-txt3">no faucet</span>
              )}
            </div>
          );
        })}
      </div>
      {tx.error && <span className="text-[10.5px] text-red">Failed: {tx.error}</span>}
    </div>
  );
}
