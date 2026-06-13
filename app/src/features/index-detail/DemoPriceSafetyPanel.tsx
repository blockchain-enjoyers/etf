import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { aggregate, DEFAULT_PARAMS } from "@meridian/sdk";
import type { SourceInput } from "@meridian/sdk";
import { useApi } from "../../lib/api";
import { queryKeys } from "../../lib/query";
import { usePriceSafety } from "../../data/usePriceSafety";

interface Props {
  vault: string;
}

// Scene constituents wired to a settable on-chain mock — get the "Go live" affordance.
const SCENE_TOKENS = [
  "0x89ec78b779e00bc99044656b04a8db059c9b7270",
  "0xb1eb0688fea9011f38275a77b1be7f2dcfb290c3",
  "0x1d2dc78a673e3040e188b2551da2ec4785fb49a1",
];

const SOURCE_LABELS = ["Consensus A", "Consensus B", "Uniswap"];
const UNISWAP_IDX = 2;
const EQUAL_DEPTH = 5_000_000n * 10n ** 18n;

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function sourceLabel(i: number): string {
  return SOURCE_LABELS[i] ?? `Source ${i + 1}`;
}

function fmtPrice(v: bigint): string {
  const n = Number(formatUnits(v, 18));
  return n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

// seedPrice * (10000 + pct*100) / 10000
function effectivePrice(seed: bigint, pct: number): bigint {
  return (seed * BigInt(10000 + pct * 100)) / 10000n;
}

type Verdict = "safe" | "degraded" | "unsafe";

function verdictClass(v: Verdict): string {
  if (v === "safe") return "text-emerald-400";
  if (v === "degraded") return "text-amber";
  return "text-red-400";
}

function ConstituentRow({
  vault,
  token,
  seed,
  sourceCount,
}: {
  vault: string;
  token: string;
  seed: bigint;
  sourceCount: number;
}) {
  const api = useApi();
  const qc = useQueryClient();

  const count = Math.max(3, sourceCount);
  const [deltas, setDeltas] = useState<number[]>(() => new Array(count).fill(0));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const isScene = SCENE_TOKENS.includes(token.toLowerCase());

  const nowSec = Math.floor(Date.now() / 1000);
  const effective = deltas.map((d) => effectivePrice(seed, d));

  const result = useMemo(() => {
    const sources: SourceInput[] = effective.map((price) => ({
      price,
      depth: EQUAL_DEPTH,
      lastUpdate: nowSec,
      healthy: true,
    }));
    return aggregate(sources, { ...DEFAULT_PARAMS, nowSec });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deltas.join(",")]);

  const state: Verdict =
    result.kept.length < DEFAULT_PARAMS.minSafeSources ? "unsafe" : result.safe ? "safe" : "degraded";

  function setDelta(i: number, v: number) {
    setDeltas((d) => d.map((x, j) => (j === i ? v : x)));
  }

  function reset() {
    setDeltas(new Array(count).fill(0));
  }

  async function goLive() {
    setSubmitting(true);
    setError(null);
    try {
      const price = effective[UNISWAP_IDX]!.toString();
      const res = await api.tamperScene({ token, price });
      setTxHash(res.txHash);
      qc.invalidateQueries({ queryKey: queryKeys.constituentPrices(vault) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-line rounded-md px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono tabular-nums text-txt text-xs">{short(token)}</span>
          <span className="text-txt2 text-xs">
            median{" "}
            <span className="font-mono tabular-nums text-txt">${fmtPrice(result.median)}</span>
          </span>
        </div>
        <span className={`text-[10px] uppercase tracking-wide font-semibold ${verdictClass(state)}`}>
          {state}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {deltas.map((d, i) => {
          const dropped = result.dropped.includes(i);
          return (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="text-txt3 w-20 shrink-0">{sourceLabel(i)}</span>
              <input
                type="range"
                min={-20}
                max={20}
                value={d}
                aria-label={`${sourceLabel(i)} delta`}
                onChange={(e) => setDelta(i, Number(e.target.value))}
                className="flex-1"
              />
              <span className="font-mono tabular-nums text-txt2 w-20 text-right shrink-0">
                ${fmtPrice(effective[i]!)}
              </span>
              {dropped && (
                <span className="text-[10px] uppercase tracking-wide text-amber w-16 shrink-0">
                  dropped
                </span>
              )}
              {!dropped && <span className="w-16 shrink-0" />}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="border border-line px-2 py-0.5 text-[11px] text-txt hover:text-txt2"
          onClick={reset}
        >
          Reset
        </button>
        {isScene && (
          <button
            type="button"
            className="border border-line px-2 py-0.5 text-[11px] text-txt hover:text-txt2 disabled:opacity-50"
            disabled={submitting}
            onClick={goLive}
          >
            {submitting ? "Sending…" : "Go live on-chain"}
          </button>
        )}
        {isScene && (
          <span className="text-[9px] uppercase tracking-wide text-txt3 border border-line rounded px-1 py-0.5">
            On-chain (testnet)
          </span>
        )}
      </div>

      {error && <p className="text-amber text-[11px] mt-1">{error}</p>}
      {txHash && (
        <p className="text-txt2 text-[11px] mt-1">
          On-chain testnet · tx{" "}
          <span className="font-mono tabular-nums text-txt">{short(txHash)}</span>
        </p>
      )}
    </div>
  );
}

export function DemoPriceSafetyPanel({ vault }: Props) {
  if (import.meta.env.VITE_DEMO_MODE !== "true") return null;

  return <PanelBody vault={vault} />;
}

function PanelBody({ vault }: Props) {
  const { data, isLoading } = usePriceSafety(vault, true);

  return (
    <div className="px-3 py-3 text-xs flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-txt2">
          Drag a source off-consensus and watch the median hold: outliers beyond the divergence band
          are discarded before they can move settlement.
        </p>
        <span className="text-[9px] uppercase tracking-wide text-amber border border-amber/40 rounded px-1.5 py-0.5 shrink-0 ml-2">
          Sandbox simulation — synthetic prices
        </span>
      </div>

      {isLoading && <p className="text-txt3">Loading seed prices…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <p className="text-txt3">No constituent prices available.</p>
      )}

      {data?.map((c) => (
        <ConstituentRow
          key={c.token}
          vault={vault}
          token={c.token}
          seed={BigInt(c.price)}
          sourceCount={c.sourceCount}
        />
      ))}
    </div>
  );
}
