import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "../../lib/api";
import { queryKeys } from "../../lib/query";
import { robinhoodChainTestnet } from "../../lib/wagmi";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";

const EXPLORER = robinhoodChainTestnet.blockExplorers?.default.url ?? "";

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-txt3">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-cyan break-all hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="font-mono text-xs text-txt break-all">{value}</span>
      )}
    </div>
  );
}

/**
 * Post-deploy screen: the vault is live on-chain (tx + address shown); we then poll the
 * backend via getBasket(address) — until it resolves the index is still being indexed.
 */
export function DeploySuccess({
  vaultAddress,
  txHash,
  symbol,
  name,
}: {
  vaultAddress: string;
  txHash: string | null;
  symbol: string;
  name: string;
}) {
  const navigate = useNavigate();
  const api = useApi();

  // Poll until the backend has indexed the new vault. getBasket throws (404) until then.
  const indexed = useQuery({
    queryKey: queryKeys.basket(vaultAddress),
    queryFn: () => api.getBasket(vaultAddress),
    enabled: Boolean(vaultAddress),
    retry: false,
    refetchInterval: (q) => (q.state.status === "success" ? false : 4000),
  });
  const isIndexed = indexed.isSuccess;
  // A registry index deploys empty — its manager must seed the genesis basket before anyone can trade.
  // Steer them straight into Liquidity → Bootstrap rather than the (still-locked) Trade tab.
  const needsSetup = isIndexed && indexed.data?.vaultType === "registry";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/90 backdrop-blur-sm p-6">
      <div className="w-full max-w-lg rounded-xl border border-line bg-bg2 p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-10 h-10 rounded-full bg-emerald/15 text-emerald text-xl">
            ✓
          </span>
          <div>
            <h2 className="text-base font-semibold text-txt">Index deployed</h2>
            <p className="text-xs text-txt2">
              {symbol} · {name}
            </p>
          </div>
        </div>

        <Row
          label="Vault address"
          value={vaultAddress}
          href={EXPLORER ? `${EXPLORER}/address/${vaultAddress}` : undefined}
        />
        <Row
          label="Transaction"
          value={txHash ?? "—"}
          href={EXPLORER && txHash ? `${EXPLORER}/tx/${txHash}` : undefined}
        />

        <div className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
          <span className="text-[11px] uppercase tracking-wide text-txt3">Backend indexing</span>
          {isIndexed ? <Chip variant="ok">indexed ✓</Chip> : <Chip variant="pend">waiting…</Chip>}
        </div>
        {!isIndexed && (
          <p className="text-[11px] text-txt2">
            The vault is live on-chain. Our backend is indexing it — usually a few seconds. You can
            open it once it's indexed.
          </p>
        )}

        {needsSetup && (
          <div className="flex items-start gap-2.5 rounded-md border border-cyan-dim bg-cyan/[0.05] px-3 py-2.5 text-[11.5px] text-txt2">
            <span aria-hidden className="mt-px text-cyan">⚙</span>
            <p>
              <b className="text-cyan font-semibold">One more step: set up your index.</b> A registry index starts
              empty — seed its genesis basket in Liquidity → Bootstrap to open trading.
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            variant="primary"
            full
            disabled={!isIndexed}
            onClick={() => navigate(needsSetup ? `/index/${vaultAddress}?tab=liquidity` : `/index/${vaultAddress}`)}
            aria-label={needsSetup ? "Set up the deployed index" : "Open the deployed index"}
          >
            {!isIndexed ? "Waiting for indexation…" : needsSetup ? "Set up index →" : "Open index →"}
          </Button>
          <Button onClick={() => navigate("/explore")} aria-label="Back to markets">
            Markets
          </Button>
        </div>
      </div>
    </div>
  );
}
