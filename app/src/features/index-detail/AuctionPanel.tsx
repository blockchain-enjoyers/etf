import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useChainId } from "wagmi";
import { addresses } from "@meridian/contracts";
import { Button } from "../../components/Button";
import { GateBanner } from "../../components/GateBanner";
import { formatQty } from "../../lib/format";
import { useApi } from "../../lib/api";
import { useAuctionStatus } from "../../data/useAuctionStatus";
import { useCapabilities } from "../../capabilities/use-capabilities";
import { useTxPlan } from "../../wallet/use-tx-plan";
import type { Reason as GateReason } from "../../capabilities/use-capabilities";

interface Props {
  vaultAddress: string;
  manager: string;
}

interface ReleaseRow {
  token: string;
  out: string;
}

interface AcquireRow {
  token: string;
  start: string;
  end: string;
}

const SEC_CLASS = "text-[10px] uppercase tracking-wider text-txt3 mb-1.5";
const INPUT_CLASS =
  "border border-line rounded px-2 py-1 font-mono text-xs bg-surface2 text-txt placeholder:text-txt3 focus:outline-none focus:border-cyan";
const SUBLABEL = "text-[10px] uppercase tracking-wider text-txt3 mb-1";

const EXEC_LABELS = ["Manager-only", "Allowlist"] as const;

function parse18(value: string): bigint {
  try {
    return parseUnits(value, 18);
  } catch {
    return 0n;
  }
}

function TxFeedback({
  tx,
}: {
  tx: ReturnType<typeof useTxPlan>;
}) {
  const running = tx.status === "running";
  if (tx.total === 0 && tx.status !== "success" && !tx.error) return null;
  return (
    <div className="mt-2 flex flex-col gap-1 text-xs" aria-label="transaction status">
      {tx.total > 0 && (
        <div className="flex items-center justify-between text-[11px] text-txt3">
          <span>{tx.steps[tx.currentStep]?.label ?? (tx.status === "success" ? "Confirmed ✓" : "Working…")}</span>
          <span>
            {Math.min(tx.currentStep + (running ? 1 : 0), tx.total)} / {tx.total}
          </span>
        </div>
      )}
      {tx.status === "success" && <span className="text-emerald">Confirmed ✓</span>}
      {tx.error && <span className="text-red">Failed: {tx.error}</span>}
    </div>
  );
}

export function AuctionPanel({ vaultAddress, manager }: Props) {
  const api = useApi();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();

  const { data: auction } = useAuctionStatus(vaultAddress, address);
  const deployed = auction?.deployed ?? false;
  const execMode = deployed ? auction?.execMode : undefined;
  const execLabel = execMode !== undefined ? EXEC_LABELS[execMode] ?? "—" : "—";

  const managerGate = useCapabilities("regular").canCurate(manager);
  const isManager = managerGate.enabled;
  const onAllowlist = auction?.openAllow === true;

  // canOpen depends on execMode: manager-only → connected manager;
  // allowlist → connected & on the openAllow list. (Permissionless is contract-disabled.)
  const connectedHere = isConnected && !!address && chainId in addresses;
  let canOpen = false;
  let openReason: GateReason = managerGate.reason;
  if (execMode === 1) {
    canOpen = connectedHere && onAllowlist;
    openReason = !connectedHere
      ? isConnected
        ? "wrong-chain"
        : "wallet-disconnected"
      : onAllowlist
        ? "ok"
        : "manager-mismatch";
  } else {
    // manager-only (0) or unknown → manager check
    canOpen = isManager;
    openReason = managerGate.reason;
  }

  // Distinct executors per action so each surface shows its own progress/error.
  // open / setExecMode target the RebalanceAuction singleton (in the static address book) → no seed.
  const openTx = useTxPlan();
  const execTx = useTxPlan();

  const [releaseRows, setReleaseRows] = useState<ReleaseRow[]>([{ token: "", out: "" }]);
  const [acquireRows, setAcquireRows] = useState<AcquireRow[]>([{ token: "", start: "", end: "" }]);
  const [duration, setDuration] = useState("3600");

  const durationOk = Number(duration) > 0;
  // Every leg must carry a token and a positive amount, and each acquire leg must decay from a
  // start ≥ end (both > 0) — otherwise a blank/zero entry would submit a degenerate zero-price auction.
  const releaseLegsOk =
    releaseRows.length > 0 &&
    releaseRows.every((r) => r.token.length > 0 && parse18(r.out) > 0n);
  const acquireLegsOk =
    acquireRows.length > 0 &&
    acquireRows.every(
      (r) =>
        r.token.length > 0 &&
        parse18(r.start) > 0n &&
        parse18(r.end) > 0n &&
        parse18(r.start) >= parse18(r.end),
    );
  const legsOk = releaseLegsOk && acquireLegsOk;
  // The contract reverts OverlappingLeg(token) if any token sits on both legs, so the same address
  // (case-insensitive) must never appear in both release and acquire.
  const releaseTokenSet = new Set(
    releaseRows.map((r) => r.token.trim().toLowerCase()).filter((t) => t.length > 0),
  );
  const legsDisjoint = !acquireRows.some((r) => {
    const t = r.token.trim().toLowerCase();
    return t.length > 0 && releaseTokenSet.has(t);
  });
  const openRunning = openTx.status === "running";
  const openSubmitDisabled = !canOpen || !durationOk || !legsOk || !legsDisjoint || openRunning;

  function handleOpen() {
    if (!canOpen) return;
    const release = releaseRows.map((r) => ({ token: r.token, releaseOut: parse18(r.out).toString() }));
    const acquire = acquireRows.map((r) => ({
      token: r.token,
      startIn: parse18(r.start).toString(),
      endIn: parse18(r.end).toString(),
    }));
    void openTx.run(() =>
      api.buildAuctionOpenTx(vaultAddress, {
        account: address!,
        durationSec: Math.floor(Number(duration)),
        release,
        acquire,
      }),
    );
  }

  // BID: acquire token addresses are NOT readable on-chain (private _auc), so the bidder
  // must enter them manually, paired positionally with the currentAcquireIn amounts.
  const acquireAmounts: string[] = auction?.acquireIn ?? [];
  const noActiveAuction = !deployed || acquireAmounts.length === 0;

  const [bidTokens, setBidTokens] = useState<string[]>([]);
  const enteredBidTokens = acquireAmounts.map((_, i) => bidTokens[i] ?? "");

  // The bid plan approves each acquire token, which isn't in the static address book — seed them.
  const bidTx = useTxPlan(enteredBidTokens.filter((t) => t.length > 0));
  const bidRunning = bidTx.status === "running";

  const allBidTokensEntered =
    acquireAmounts.length > 0 && enteredBidTokens.every((t) => t.length > 0);
  const bidDisabled = !connectedHere || noActiveAuction || !allBidTokensEntered || bidRunning;

  function handleBid() {
    if (bidDisabled) return;
    const acquire = enteredBidTokens.map((token, i) => ({
      token,
      amount: acquireAmounts[i] ?? "0",
    }));
    void bidTx.run(() => api.buildAuctionBidTx(vaultAddress, { account: address!, acquire }));
  }

  function handleSetExecMode(mode: number) {
    if (!isManager) return;
    void execTx.run(() => api.buildAuctionSetExecModeTx(vaultAddress, { mode, account: address! }));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className={SEC_CLASS + " mb-0"}>Rebalance auction · Advanced</div>
        <span
          data-testid="auction-exec-mode"
          className="font-mono text-[10px] font-medium text-txt2 border border-line rounded-full px-2 py-px"
        >
          {execLabel}
        </span>
      </div>

      <p className="text-[11px] text-txt2 mb-3">
        Advanced keeper / arbitrageur surface. Opening an auction starts a Dutch auction that swaps
        tokens against the vault; bidding fills it. Curator / keeper action — proceed with care.
      </p>

      {isManager && (
        <div className="flex items-center gap-2 mb-4">
          <label htmlFor="auction-execmode" className="text-[11px] text-txt2">
            Execution mode
          </label>
          <select
            id="auction-execmode"
            aria-label="execution mode"
            value={execMode ?? 0}
            onChange={(e) => handleSetExecMode(Number(e.target.value))}
            className="border border-line rounded px-2 py-1 text-xs bg-surface2 text-txt focus:outline-none focus:border-cyan"
          >
            <option value={0}>Manager-only</option>
            <option value={1}>Allowlist</option>
          </select>
        </div>
      )}

      {/* OPEN */}
      <div className="border border-line rounded-lg p-3 mb-4 bg-surface2">
        <div className={SEC_CLASS}>Open auction</div>
        <p className="text-[11px] text-txt2 mb-2">
          Advanced: opens a Dutch auction that swaps against the vault. Curator / keeper action.
        </p>

        {!canOpen ? (
          <GateBanner gate={{ enabled: false, reason: openReason }} />
        ) : (
          <>
            <div className={SUBLABEL}>Release (vault sends)</div>
            <div className="flex flex-col gap-1.5 mb-2">
              {releaseRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={row.token}
                    onChange={(e) => {
                      const next = [...releaseRows];
                      next[i] = { ...next[i]!, token: e.target.value };
                      setReleaseRows(next);
                    }}
                    placeholder="0x release token"
                    className={"flex-1 " + INPUT_CLASS}
                    aria-label={`Release token row ${i + 1}`}
                  />
                  <input
                    type="text"
                    value={row.out}
                    onChange={(e) => {
                      const next = [...releaseRows];
                      next[i] = { ...next[i]!, out: e.target.value };
                      setReleaseRows(next);
                    }}
                    placeholder="amount out"
                    className={"w-28 " + INPUT_CLASS}
                    aria-label={`Release amount row ${i + 1}`}
                  />
                </div>
              ))}
            </div>
            <Button
              onClick={() => setReleaseRows((r) => [...r, { token: "", out: "" }])}
              className="text-[11px] mb-3"
            >
              + Add release
            </Button>

            <div className={SUBLABEL}>Acquire (vault receives)</div>
            <div className="flex flex-col gap-1.5 mb-2">
              {acquireRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={row.token}
                    onChange={(e) => {
                      const next = [...acquireRows];
                      next[i] = { ...next[i]!, token: e.target.value };
                      setAcquireRows(next);
                    }}
                    placeholder="0x acquire token"
                    className={"flex-1 " + INPUT_CLASS}
                    aria-label={`Acquire token row ${i + 1}`}
                  />
                  <input
                    type="text"
                    value={row.start}
                    onChange={(e) => {
                      const next = [...acquireRows];
                      next[i] = { ...next[i]!, start: e.target.value };
                      setAcquireRows(next);
                    }}
                    placeholder="start in"
                    className={"w-24 " + INPUT_CLASS}
                    aria-label={`Acquire start row ${i + 1}`}
                  />
                  <input
                    type="text"
                    value={row.end}
                    onChange={(e) => {
                      const next = [...acquireRows];
                      next[i] = { ...next[i]!, end: e.target.value };
                      setAcquireRows(next);
                    }}
                    placeholder="end in"
                    className={"w-24 " + INPUT_CLASS}
                    aria-label={`Acquire end row ${i + 1}`}
                  />
                </div>
              ))}
            </div>
            <Button
              onClick={() => setAcquireRows((r) => [...r, { token: "", start: "", end: "" }])}
              className="text-[11px] mb-3"
            >
              + Add acquire
            </Button>

            <div className="flex items-center gap-2 mb-3">
              <label htmlFor="auction-duration" className="text-[11px] text-txt2">
                Duration (seconds)
              </label>
              <input
                id="auction-duration"
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className={"w-28 " + INPUT_CLASS}
                aria-label="Duration"
              />
            </div>

            {!legsOk &&
              (releaseRows.some((r) => r.token.length > 0 || r.out.length > 0) ||
                acquireRows.some((r) => r.token.length > 0 || r.start.length > 0 || r.end.length > 0)) && (
                <p className="text-[11px] text-red mb-2">
                  Each release leg needs a token and a positive amount; each acquire leg needs a token
                  with positive start in ≥ end in.
                </p>
              )}

            {!legsDisjoint && (
              <p className="text-[11px] text-red mb-2">
                Release and acquire legs must not share a token (the contract rejects overlapping legs).
              </p>
            )}

            <Button
              variant="primary"
              full
              onClick={handleOpen}
              disabled={openSubmitDisabled}
              aria-label="Open auction"
            >
              Open auction
            </Button>
            <TxFeedback tx={openTx} />
          </>
        )}
      </div>

      {/* BID */}
      <div className="border border-line rounded-lg p-3 bg-surface2">
        <div className={SEC_CLASS}>Bid (fill the live auction)</div>
        <p className="text-[11px] text-txt2 mb-2">
          Acquire token addresses are not readable on-chain — enter each one manually. The bid approves
          and pulls these tokens from your wallet and pays the opener a tip.
        </p>

        {noActiveAuction ? (
          <p className="text-[12px] text-txt2">No active auction / unavailable.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 mb-3">
              {acquireAmounts.map((amount, i) => {
                const token = enteredBidTokens[i]!;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={token}
                      onChange={(e) => {
                        const next = [...enteredBidTokens];
                        next[i] = e.target.value;
                        setBidTokens(next);
                      }}
                      placeholder="0x acquire token"
                      className={"flex-1 " + INPUT_CLASS}
                      aria-label={`Bid acquire token ${i + 1}`}
                    />
                    <span className="font-mono text-xs text-txt tabular-nums w-24 text-right">
                      {formatQty(amount)}
                    </span>
                  </div>
                );
              })}
            </div>

            <Button
              variant="primary"
              full
              onClick={handleBid}
              disabled={bidDisabled}
              aria-label="Bid"
            >
              Bid
            </Button>
            <TxFeedback tx={bidTx} />
          </>
        )}
      </div>

      {isManager && <TxFeedback tx={execTx} />}
    </div>
  );
}
