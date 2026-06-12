import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFeed } from "../../data/useFeed";
import { useBaskets } from "../../data/useBaskets";
import { formatUsd, formatSignedPctFromBps } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Chip } from "../../components/Chip";
import { EstBadge } from "../../components/EstBadge";
import { Skeleton } from "../../components/Skeleton";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import type { BasketSummary, FeedItem } from "@meridian/sdk";

type SortKey = "symbol" | "name" | "nav" | "status";
type SortDir = "asc" | "desc";

const COLUMN_COUNT = 8;

const VAULT_TYPE_LABEL: Record<string, string> = {
  basket: "Static",
  managed: "Managed",
  committed: "Committed",
  rebalance: "Rebalance",
  registry: "Registry",
};

interface MergedRow {
  vaultAddress: string;
  symbol: string;
  name: string;
  nav: string | null;
  estimated: boolean;
  marketStatus: FeedItem["marketStatus"] | null;
  weightMethod?: string;
  change24hBps?: number;
  vaultType: string;
}

// Baskets are the source of truth for "what exists"; feed overlays NAV/status when present.
// A freshly created basket appears immediately (in /baskets) even before it has a NAV snapshot.
function mergeData(feed: FeedItem[], baskets: BasketSummary[]): MergedRow[] {
  const feedByVault = new Map(feed.map((f) => [f.vaultAddress, f]));
  return baskets.map((b) => {
    const f = feedByVault.get(b.vaultAddress);
    return {
      vaultAddress: b.vaultAddress,
      symbol: b.symbol,
      name: b.name,
      nav: f?.nav ?? null,
      estimated: f?.estimated ?? false,
      marketStatus: f?.marketStatus ?? null,
      weightMethod: b.weightMethod,
      change24hBps: f?.change24hBps,
      vaultType: b.vaultType ?? "basket",
    };
  });
}

function compareRows(a: MergedRow, b: MergedRow, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  if (key === "symbol") cmp = a.symbol.localeCompare(b.symbol);
  else if (key === "name") cmp = a.name.localeCompare(b.name);
  else if (key === "nav") {
    const an = a.nav == null ? -1n : BigInt(a.nav);
    const bn = b.nav == null ? -1n : BigInt(b.nav);
    cmp = an < bn ? -1 : an > bn ? 1 : 0;
  } else if (key === "status") cmp = (a.marketStatus ?? "").localeCompare(b.marketStatus ?? "");
  return dir === "asc" ? cmp : -cmp;
}

const TH_CLASS =
  "text-left text-txt3 font-semibold text-[9px] uppercase tracking-[0.1em] px-2.5 py-1.5 border-b border-line whitespace-nowrap";
const TD_CLASS = "px-2.5 py-2 border-b border-line-soft font-mono tabular-nums";

function SortableHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      className={cn(TH_CLASS, "cursor-pointer select-none hover:text-txt2")}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      {active && <span className="ml-1 text-cyan">{dir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );
}

function StatusCell({
  estimated,
  marketStatus,
}: {
  estimated: boolean;
  marketStatus: FeedItem["marketStatus"];
}) {
  if (estimated) {
    return (
      <Chip variant="pend">
        <EstBadge className="border-0 bg-transparent px-0 text-amber" />
      </Chip>
    );
  }
  const variant = marketStatus === "regular" ? "ok" : marketStatus === "unknown" ? "bad" : "neutral";
  const label = marketStatus === "regular" ? "live" : marketStatus === "unknown" ? "halt" : "closed";
  return <Chip variant={variant}>{label}</Chip>;
}

function SkeletonRow() {
  return (
    <tr data-testid="skeleton-row" aria-hidden="true">
      {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
        <td key={i} className={TD_CLASS}>
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

export function ExploreScreen() {
  const navigate = useNavigate();
  const feedQuery = useFeed();
  const basketsQuery = useBaskets();

  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [query, setQuery] = useState("");

  const rows = useMemo<MergedRow[]>(() => {
    if (!basketsQuery.data) return [];
    const merged = mergeData(feedQuery.data?.items ?? [], basketsQuery.data);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? merged.filter(
          (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
        )
      : merged;
    return [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [feedQuery.data, basketsQuery.data, sortKey, sortDir, query]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const isLoading = feedQuery.isLoading || basketsQuery.isLoading;
  const isError = feedQuery.isError || basketsQuery.isError;

  function handleRetry() {
    feedQuery.refetch();
    basketsQuery.refetch();
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="flex items-center gap-3 border-b border-line bg-bg2 px-[18px] py-2.5 shrink-0">
        <h2 className="text-sm font-semibold tracking-wide text-txt">Markets</h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-txt3">
          instrument list
        </span>
        <div className="flex-1" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 search…"
          aria-label="search indexes"
          className="border border-line rounded-md bg-surface px-2.5 py-1.5 text-xs text-txt2 w-[220px] focus:outline-none focus:border-cyan-dim"
        />
      </header>
      {isError ? (
        <div className="p-[18px]">
          <ErrorState onRetry={handleRetry} />
        </div>
      ) : (
        <div className="overflow-auto flex-1">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr>
                <SortableHeader
                  label="Symbol"
                  sortKey="symbol"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Name"
                  sortKey="name"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="NAV"
                  sortKey="nav"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
                <th className={TH_CLASS}>24h</th>
                <SortableHeader
                  label="Status"
                  sortKey="status"
                  current={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
                <th className={TH_CLASS}>Weight method</th>
                <th className={TH_CLASS}>Type</th>
                <th className={TH_CLASS} />
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}

              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="px-2.5 py-10 text-center">
                    <EmptyState message="No indexes yet" />
                  </td>
                </tr>
              )}

              {!isLoading &&
                rows.map((row) => (
                  <tr
                    key={row.vaultAddress}
                    onClick={() => navigate(`/index/${row.vaultAddress}`)}
                    className="hover:bg-surface2 cursor-pointer transition-colors"
                  >
                    <td className={cn(TD_CLASS, "font-bold text-txt")}>{row.symbol}</td>
                    <td className={cn(TD_CLASS, "font-sans text-txt2")}>{row.name}</td>
                    <td className={cn(TD_CLASS, "text-right", row.nav == null && "text-txt3")}>
                      {row.nav == null ? "—" : formatUsd(row.nav)}
                    </td>
                    <td
                      className={cn(
                        TD_CLASS,
                        "text-right",
                        row.change24hBps == null
                          ? "text-txt3"
                          : row.change24hBps >= 0
                            ? "text-emerald"
                            : "text-red",
                      )}
                    >
                      {row.change24hBps == null ? "—" : formatSignedPctFromBps(row.change24hBps)}
                    </td>
                    <td className={TD_CLASS}>
                      {row.marketStatus == null ? (
                        <span className="text-txt3 text-[10px]">no NAV yet</span>
                      ) : (
                        <StatusCell estimated={row.estimated} marketStatus={row.marketStatus} />
                      )}
                    </td>
                    <td className={cn(TD_CLASS, "text-txt2")}>{row.weightMethod ?? "—"}</td>
                    <td className={cn(TD_CLASS, "text-txt2 text-[10px]")}>
                      {VAULT_TYPE_LABEL[row.vaultType] ?? row.vaultType}
                    </td>
                    <td className={cn(TD_CLASS, "text-txt3 text-[10px] text-right")}>open ▸</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
