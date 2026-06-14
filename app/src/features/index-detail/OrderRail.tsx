import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { BasketDetail, NavResponse, RebalanceDetail } from "@meridian/sdk";
import { Button } from "../../components/Button";
import { GateBanner } from "../../components/GateBanner";
import { EstBadge } from "../../components/EstBadge";
import { HelpTip } from "../../components/HelpTip";
import { TokenIcon } from "../../components/TokenIcon";
import { RadioCards } from "../../components/RadioCards";
import { cn } from "../../lib/cn";
import { formatQty, formatUsd, shortenAddress } from "../../lib/format";
import { AssetFunding } from "../../components/AssetFunding";
import { queryKeys } from "../../lib/query";
import { useApi } from "../../lib/api";
import { useCapabilities } from "../../capabilities/use-capabilities";
import { useMintQuote } from "../../data/useMintQuote";
import { useForwardQueue } from "../../data/useForwardQueue";
import { useSettleGateStatus } from "../../data/useSettleGateStatus";
import { useTxPlan } from "../../wallet/use-tx-plan";

/** Parse a human cash amount into the cash token's base units (decimals vary per token: USDG 18, USDC 6). */
function parseCash(value: string, decimals: number): bigint {
  try {
    return parseUnits(value, decimals);
  } catch {
    return 0n;
  }
}

/** Fee base-unit amount → "$X.XX" (fee token pegged to $1). Decimals come from the fee token (USDG 18). */
function formatUsdgFee(baseUnits: string, decimals = 18): string {
  return `$${Number(formatUnits(BigInt(baseUnits), decimals)).toFixed(2)}`;
}

interface Props {
  vaultAddress: string;
  basket: BasketDetail;
  nav: NavResponse | null;
  rebalance?: RebalanceDetail | null;
}

export type RedeemMethod = "inkind" | "cash";
export type Direction = "mint" | "redeem";

const RAIL_SEC = "px-3.5 py-3 border-b border-line";
const LAB = "text-[9.5px] uppercase tracking-[0.12em] text-txt3 mb-2.5 flex items-center gap-1.5";
const ROW = "flex justify-between items-center py-1.5 text-[11.5px] border-b border-line-soft last:border-0";
const ROW_K = "text-txt2";
const ROW_V = "font-mono font-semibold text-txt";

function CreatePanel({ vaultAddress, basket, nav }: Props) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [units, setUnits] = useState(1);
  // No NAV: mint is oracle-free, so default market status; estimated off.
  const marketStatus = nav?.marketStatus ?? "unknown";
  const caps = useCapabilities(marketStatus, vaultAddress);
  const mintGate = caps.canMint(vaultAddress, basket.frozen);

  const isShareBased = basket.vaultType === "rebalance";
  const unitSize = BigInt(basket.unitSize);
  // Display-only: nUnits the wallet receives. The backend derives the on-chain create arg from `units`.
  const receiveArg = isShareBased ? BigInt(units) * unitSize : BigInt(units);

  // The deposit set + per-token $ come from the backend mint-quote (oracle-free pull amounts).
  // `units` is the human stepper count; the backend scales by unitSize for share-based vaults.
  const unitsArg = String(units);
  const quote = useMintQuote(vaultAddress, unitsArg, address);
  const deposits = quote.data?.deposits ?? [];
  // Flat USDG create fee pulled by FeeCore.create() (managed/rebalance). Absent on the no-op fee seam.
  const mintFee = quote.data?.fee;

  // Constituent tokens are the allowlist the executor checks every approve/permit against.
  // The vault clone is the terminal create-step `to` and isn't in the static address book, so seed it too.
  const constituentTokens = deposits.map((d) => d.token);
  const tx = useTxPlan([vaultAddress, ...constituentTokens]);

  function handleMint() {
    void tx
      .run(
        () => api.buildMintTx(vaultAddress, { account: address!, units: unitsArg }),
        (permits) => api.finalizeMintTx(vaultAddress, { account: address!, units: unitsArg, permits }),
      )
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.nav(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.basket(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.rebalance(vaultAddress) });
        void quote.refetch();
      });
  }

  const estimated = nav?.estimated ?? false;
  // Est. value = units × NAV/unit (18-dec USD). NAV is per unit, so use the human unit count even
  // for share-based vaults. Null NAV → no figure (rendered as "—").
  const navPerUnit = nav?.nav ? BigInt(nav.nav) : null;
  const estValue18 = navPerUnit != null ? (BigInt(units) * navPerUnit).toString() : null;

  // Share-based vaults mint `units × unitSize` 18-dec shares — format to a human figure (not raw base
  // units like 1000000000000000000000). Count-based vaults receive the plain unit count.
  const receive = `${isShareBased ? formatQty(receiveArg.toString()) : receiveArg.toString()} ${basket.symbol}`;
  const running = tx.status === "running";
  const currentLabel = tx.steps[tx.currentStep]?.label;

  return (
    <>
      <div className={RAIL_SEC}>
        <div className={LAB}>
          Units
          <HelpTip>
            How many {basket.symbol} index tokens to mint. The deposit list below updates to the exact basket of
            underlying tokens needed for this size.
          </HelpTip>
        </div>
        <div className="flex items-stretch border border-line rounded-md overflow-hidden bg-surface">
          <button
            type="button"
            onClick={() => setUnits((v) => Math.max(1, v - 1))}
            aria-label="decrease units"
            className="w-[42px] bg-surface2 text-txt text-lg hover:bg-surface3 hover:text-cyan"
          >
            −
          </button>
          <div className="flex-1 flex flex-col items-center justify-center py-1.5">
            <input
              value={units}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setUnits(Number.isNaN(v) ? 1 : Math.max(1, v));
              }}
              inputMode="numeric"
              aria-label="units"
              className="bg-transparent border-0 text-txt font-mono text-xl font-semibold text-center w-full outline-none"
            />
            <span className="text-[9px] text-txt3 tracking-widest uppercase">{basket.symbol} units</span>
          </div>
          <button
            type="button"
            onClick={() => setUnits((v) => v + 1)}
            aria-label="increase units"
            className="w-[42px] bg-surface2 text-txt text-lg hover:bg-surface3 hover:text-cyan"
          >
            +
          </button>
        </div>
        <div className={cn(ROW, "mt-2.5")}>
          <span className={ROW_K}>Est. value</span>
          <span className={ROW_V}>
            {estValue18 != null ? (
              <span className="inline-flex items-center gap-1">
                {estimated && <span aria-hidden className="text-txt2">≈</span>}
                {formatUsd(estValue18)}
                {estimated && <EstBadge />}
              </span>
            ) : (
              "—"
            )}
          </span>
        </div>
        <div className={cn(ROW, "border-0")}>
          <span className={ROW_K}>Basis</span>
          <span className={ROW_V}>in-kind · NAV-free</span>
        </div>
      </div>

      <div className={RAIL_SEC}>
        <div className={LAB}>
          In-kind deposit list
          <HelpTip>
            To mint in-kind you deposit exactly these underlying tokens — no cash, no oracle. The vault gives you{" "}
            {basket.symbol} 1:1 against them.
          </HelpTip>
        </div>
        <div className="border border-line rounded-md overflow-hidden">
          {deposits.length === 0 ? (
            <div className="px-2.5 py-[7px] text-[11px] text-txt3">
              {quote.isLoading ? "Loading deposit list…" : "Set a unit size to preview the deposit list."}
            </div>
          ) : (
            deposits.map((d) => (
              <div
                key={d.token}
                className="flex items-center gap-2 px-2.5 py-[7px] border-b border-line-soft text-[11px] last:border-b-0"
              >
                <TokenIcon token={d.token} symbol={d.symbol} />
                <span className="text-txt">{d.symbol || shortenAddress(d.token)}</span>
                <span className="ml-auto flex items-center gap-1.5 font-mono text-txt tabular-nums">
                  {formatQty(d.amount)}
                  <span className="font-mono text-[9.5px] text-txt3">≈{formatUsd(d.valueUsd)}</span>
                  {estimated && <EstBadge />}
                </span>
              </div>
            ))
          )}
        </div>
        {deposits.length > 0 && (
          <div className="mt-2">
            <AssetFunding
              account={address}
              required={deposits.map((d) => ({ token: d.token, symbol: d.symbol, amount: d.amount }))}
            />
          </div>
        )}
      </div>

      <div className={cn(RAIL_SEC, "text-[11px]")}>
        <div className={ROW}>
          <span className={ROW_K}>You deposit</span>
          <span className={ROW_V}>
            {deposits.length} token{deposits.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className={ROW}>
          <span className={ROW_K}>You receive</span>
          <span className={ROW_V}>{receive}</span>
        </div>
        <div className={ROW}>
          <span className={ROW_K}>Price basis</span>
          <span className={cn(ROW_V, "text-emerald")}>none (in-kind)</span>
        </div>
        <div className={ROW}>
          <span className={ROW_K}>Flow fee</span>
          <span className={cn(ROW_V, "text-emerald")}>0%</span>
        </div>
        <div className={cn(ROW, "border-0")}>
          <span className={ROW_K}>Create fee</span>
          <span className={cn(ROW_V, mintFee ? "text-txt" : "text-emerald")}>
            {mintFee ? (
              <span className="inline-flex items-center gap-1">
                {formatUsd(mintFee.valueUsd)}
                <span className="font-mono text-[9.5px] text-txt3">in {mintFee.symbol}</span>
              </span>
            ) : (
              "$0.00"
            )}
          </span>
        </div>
      </div>

      <div className="px-3.5 py-3">
        {mintGate.enabled ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              full
              onClick={handleMint}
              disabled={running}
              aria-label="Mint basket tokens"
              className="py-3"
            >
              {running ? "Minting…" : `Mint ${receive} (in-kind)`}
            </Button>
            {tx.total > 0 && (
              <div className="flex items-center justify-between text-[11px] text-txt3">
                <span>{currentLabel ?? (tx.status === "success" ? "Confirmed ✓" : "Working…")}</span>
                <span>
                  {Math.min(tx.currentStep + (running ? 1 : 0), tx.total)} / {tx.total}
                </span>
              </div>
            )}
            {tx.status === "success" && (
              <div className="flex flex-col gap-1 text-xs" aria-label="transaction status">
                <span className="text-emerald">Confirmed ✓</span>
              </div>
            )}
            {tx.error && (
              <div className="flex flex-col gap-1 text-xs" aria-label="transaction status">
                <span className="text-red">Failed: {tx.error}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button full disabled aria-label="Mint basket tokens" className="py-3">
              Mint
            </Button>
            <GateBanner gate={mintGate} />
          </div>
        )}
        <p className="mt-2.5 text-center text-[10px] leading-relaxed text-txt3">
          In-kind · oracle-free · always available — even when closed.
        </p>
      </div>
    </>
  );
}

/**
 * Registry create rail: a registry vault has no in-kind mint surface (deferred) — create routes to
 * FORWARD CASH via buildForwardCreateTx. The user pays USDG now and is minted units at the next open
 * (forward-priced), plus a flat USDG create fee disclosed from the forward-queue `fees` DTO.
 */
function RegistryCreatePanel({ vaultAddress, basket, nav }: Props) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [amount, setAmount] = useState("");

  const caps = useCapabilities("regular", vaultAddress);
  const { data: queue } = useForwardQueue(vaultAddress, true);
  const { data: gate } = useSettleGateStatus(vaultAddress, true);
  // Bootstrap status is a queue-independent on-chain signal (totalSupply > 0) on the basket detail —
  // NOT the settle gate's g0, which needs a forward queue and would read "not bootstrapped" forever
  // on a registry vault that hasn't enabled cash settlement yet.
  const bootstrapped = basket.bootstrapped !== false;
  const createGate = caps.canForwardCreate(vaultAddress, bootstrapped);
  // Cash buy/mint needs a wired forward queue. A registry index that hasn't enabled cash settlement has
  // none, so surface that explicitly rather than letting the plan dead-end as a generic "halted" gate.
  const cashEnabled = !!queue?.queueAddress;
  const cashNotEnabled = createGate.enabled && queue !== undefined && !cashEnabled;

  const fees = queue?.fees ?? null;
  // Cash leg = the queue's stable token; its decimals vary (USDG 18-dec, MockUSDC 6-dec), so parse + the
  // estimate use the queue-reported decimals, not a hardcoded 6. cashToken from the queue (registry has
  // none on the Basket row), falling back to the basket's cashToken for managed/rebalance.
  const cashDecimals = queue?.cashDecimals ?? 18;
  const cashToken = queue?.cashToken ?? basket.cashToken ?? "";
  const cash = parseCash(amount, cashDecimals);
  // Plan destinations: approve → cash token, requestCreate → the queue. Neither is in the static address
  // book (per-vault queue clone + the registry cash token), so seed both into the tx-plan allowlist.
  const tx = useTxPlan([cashToken, queue?.queueAddress].filter(Boolean) as string[]);
  const running = tx.status === "running";

  // Estimate only (IRON RULE): shares = cash * 1e18 / navPerShare; struck for real at the next open.
  // Prefer the gate's struck per-share; fall back to the live (off-chain) NAV per share so the estimate
  // still shows when the settle gate can't simulate (oracle/peg) — both are 18-dec base units.
  const navPerShare = gate?.navPerShare ? BigInt(gate.navPerShare) : nav?.nav ? BigInt(nav.nav) : 0n;
  const estShares =
    navPerShare > 0n ? (parseUnits(formatUnits(cash, cashDecimals), 18) * 1_000_000_000_000_000_000n) / navPerShare : 0n;

  function handleCreate() {
    if (cash <= 0n) return;
    void tx
      .run(() => api.buildForwardCreateTx(vaultAddress, { cash: cash.toString(), account: address! }))
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.forwardTickets(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.forwardQueue(vaultAddress) });
      });
  }

  const currentLabel = tx.steps[tx.currentStep]?.label;

  return (
    <>
      <div className={RAIL_SEC}>
        <div className={LAB}>
          Cash in
          <HelpTip>
            Registry indices create for cash through a forward queue. You deposit USDG now; {basket.symbol} is minted to
            you priced at the next market open, never at this estimate.
          </HelpTip>
        </div>
        <div className="flex items-stretch border border-line rounded-md overflow-hidden bg-surface">
          <span className="grid place-items-center px-3 bg-surface2 text-txt3 font-mono text-xs border-r border-line">
            USDG
          </span>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-transparent font-mono text-sm text-txt placeholder:text-txt3 px-3 py-2.5 focus:outline-none"
            aria-label="USDG amount"
          />
        </div>
        <div className={cn(ROW, "mt-2.5")}>
          <span className={ROW_K}>You receive (estimate)</span>
          <span className={cn(ROW_V, "inline-flex items-center gap-1")}>
            {navPerShare > 0n ? formatUnits(estShares, 18) : "—"} {basket.symbol}
            <EstBadge />
          </span>
        </div>
        <div className={ROW}>
          <span className={ROW_K}>Basis</span>
          <span className={ROW_V}>forward · next open</span>
        </div>
        <div className={cn(ROW, "border-0")}>
          <span className={ROW_K}>Create fee</span>
          <span className={cn(ROW_V, fees && BigInt(fees.flatCreateFee) > 0n ? "text-txt" : "text-emerald")}>
            {fees && BigInt(fees.flatCreateFee) > 0n ? `+ ${formatUsdgFee(fees.flatCreateFee, fees.feeDecimals)} USDG` : "$0.00"}
          </span>
        </div>
      </div>

      <div className="px-3.5 py-3">
        {createGate.enabled && cashEnabled ? (
          <div className="flex flex-col gap-2">
            {cashToken && (
              <AssetFunding required={[{ token: cashToken, symbol: "USDG", amount: cash.toString() }]} account={address} />
            )}
            <Button
              variant="primary"
              full
              onClick={handleCreate}
              disabled={running || cash === 0n}
              aria-label="Queue cash create"
              className="py-3"
            >
              {running ? "Queueing…" : "Queue cash create"}
            </Button>
            {tx.total > 0 && (
              <div className="flex items-center justify-between text-[11px] text-txt3">
                <span>{currentLabel ?? (tx.status === "success" ? "Confirmed ✓" : "Working…")}</span>
                <span>
                  {Math.min(tx.currentStep + (running ? 1 : 0), tx.total)} / {tx.total}
                </span>
              </div>
            )}
            {tx.status === "success" && (
              <div className="flex flex-col gap-1 text-xs" aria-label="transaction status">
                <span className="text-emerald">Confirmed ✓</span>
              </div>
            )}
            {tx.error && (
              <div className="flex flex-col gap-1 text-xs" aria-label="transaction status">
                <span className="text-red">Failed: {tx.error}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button full disabled aria-label="Queue cash create" className="py-3">
              Queue cash create
            </Button>
            {cashNotEnabled ? (
              <div className="flex items-start gap-2.5 px-2.5 py-2 rounded-md border border-cyan-dim bg-cyan/[0.05] text-[11.5px] text-txt2">
                <span aria-hidden className="mt-px text-cyan">ⓘ</span>
                <div>
                  <b className="font-semibold text-txt">Cash settlement isn&apos;t enabled yet.</b>
                  <div className="text-txt2 mt-0.5">The manager enables it in Liquidity → Enable cash settlement. Until then, use in-kind create in Liquidity.</div>
                </div>
              </div>
            ) : (
              <GateBanner gate={createGate} />
            )}
          </div>
        )}
        <p className="mt-2.5 text-center text-[10px] leading-relaxed text-txt3">
          Forward-priced · settles at the next open, not this estimate.
        </p>
      </div>
    </>
  );
}

function RedeemPanel({
  basket,
  vaultAddress,
  nav,
  method: methodProp,
  onMethodChange,
}: Props & { method?: RedeemMethod; onMethodChange?: (m: RedeemMethod) => void }) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [localMethod, setLocalMethod] = useState<RedeemMethod>("inkind");
  const method = methodProp ?? localMethod;
  const setMethod = onMethodChange ?? setLocalMethod;

  // Registry vaults have no in-kind redeem surface (deferred) — exit is cash-only via the forward queue.
  const isRegistry = basket.vaultType === "registry";

  // No NAV: redeem is oracle-free; default market status (cash copy keys off it).
  const marketStatus = nav?.marketStatus ?? "unknown";
  const caps = useCapabilities(marketStatus, vaultAddress);
  // IRON RULE: in-kind redeem is gated ONLY by wallet/contract presence, never by market state.
  const inKindGate = caps.canRedeemInKind();
  // Cash redeem routes through the forward queue (rebalance/registry); gate on AP/forward presence.
  const cashGate = caps.canForwardRedeem();
  // Cash redeem routes through a per-vault forward queue (registry + rebalance) — fetch it so we can both
  // disclose the fee and allowlist its address. Registry redeem proceeds are net of a flat USDG fee.
  const hasForward = isRegistry || basket.vaultType === "rebalance";
  const { data: queue } = useForwardQueue(vaultAddress, hasForward);
  const redeemFee = queue?.fees ?? null;

  // Cash-redeem estimate (IRON RULE: informational, struck at the next open). USDG out ≈ shares · NAV/share,
  // net of the fixed redeem fee; NAV/share is the live off-chain per-share (18-dec base units).
  const cashDecimals = queue?.cashDecimals ?? 18;
  const navPerShare = nav?.nav ? BigInt(nav.nav) : 0n;
  const sharesIn = (() => {
    try {
      return parseUnits(amount || "0", 18);
    } catch {
      return 0n;
    }
  })();
  const estCashGross = navPerShare > 0n ? (sharesIn * navPerShare) / 1_000_000_000_000_000_000n : 0n;
  const redeemFeeBase = redeemFee ? BigInt(redeemFee.flatRedeemFee) : 0n;
  const estCashNet = estCashGross > redeemFeeBase ? estCashGross - redeemFeeBase : 0n;

  // Registry forces cash; everything else honors the selected method.
  const effectiveMethod: RedeemMethod = isRegistry ? "cash" : method;
  const activeGate = effectiveMethod === "inkind" ? inKindGate : cashGate;

  // In-kind redeem targets the vault clone; cash redeem's requestRedeem targets the per-vault queue
  // clone. Neither is in the static address book, so seed both into the tx-plan allowlist.
  const tx = useTxPlan([vaultAddress, queue?.queueAddress].filter(Boolean) as string[]);
  const running = tx.status === "running";

  function handleRedeem() {
    if (!amount) return;
    const amountBigInt = BigInt(Math.round(parseFloat(amount) * 1e18));
    if (amountBigInt <= 0n) return;
    const fetcher =
      effectiveMethod === "cash"
        ? () => api.buildForwardRedeemTx(vaultAddress, { account: address!, shares: amountBigInt.toString() })
        : () => api.buildRedeemTx(vaultAddress, { account: address!, amount: amountBigInt.toString() });
    void tx.run(fetcher).then(() => {
      qc.invalidateQueries({ queryKey: queryKeys.nav(vaultAddress) });
      qc.invalidateQueries({ queryKey: queryKeys.basket(vaultAddress) });
      qc.invalidateQueries({ queryKey: queryKeys.rebalance(vaultAddress) });
      if (effectiveMethod === "cash") {
        qc.invalidateQueries({ queryKey: queryKeys.forwardTickets(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.forwardQueue(vaultAddress) });
      }
    });
  }

  const isMarketClosed =
    marketStatus === "closed" || marketStatus === "overnight" || marketStatus === "unknown";

  const breakdown = basket.constituents
    .map((c) => `${formatQty(c.unitQty)} ${shortenAddress(c.token)}`)
    .slice(0, 2)
    .join(" + ");

  const allRedeemOptions = [
    {
      value: "inkind" as const,
      label: "In-kind · instant",
      description: `${breakdown}… · available always, no pause`,
    },
    {
      value: "cash" as const,
      label: "Cash (USDG) · queued",
      description: isMarketClosed
        ? "market closed → queued, settles next open at open price, not estimate"
        : "Settle for cash at current NAV.",
    },
  ];
  // Cash redeem is forward-queue only. Registry is cash-ONLY (no in-kind surface); rebalance offers
  // both; static types are in-kind only.
  const redeemOptions = isRegistry
    ? allRedeemOptions.filter((o) => o.value === "cash")
    : basket.vaultType === "rebalance"
      ? allRedeemOptions
      : allRedeemOptions.filter((o) => o.value === "inkind");

  const currentLabel = tx.steps[tx.currentStep]?.label;

  return (
    <>
      <div className={RAIL_SEC}>
        <div className={LAB}>Amount</div>
        <div className="border border-line rounded-md p-3 bg-surface">
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent font-mono text-txt placeholder:text-txt3 focus:outline-none"
            aria-label="Redeem amount"
          />
          <span className="text-[11px] text-txt3">{basket.symbol}</span>
        </div>
      </div>

      {isRegistry ? (
        <div className={cn(RAIL_SEC, "text-[11px]")}>
          <div className={ROW}>
            <span className={ROW_K}>You receive (estimate)</span>
            <span className={cn(ROW_V, "inline-flex items-center gap-1")}>
              {navPerShare > 0n ? formatUnits(estCashNet, cashDecimals) : "—"} USDG
              <EstBadge />
            </span>
          </div>
          <div className={ROW}>
            <span className={ROW_K}>Basis</span>
            <span className={ROW_V}>forward · next open</span>
          </div>
          <div className={ROW}>
            <span className={ROW_K}>Method</span>
            <span className={cn(ROW_V, "text-txt2")}>cash · forward queue</span>
          </div>
          <div className={cn(ROW, "border-0")}>
            <span className={ROW_K}>Redeem fee</span>
            <span className={cn(ROW_V, redeemFee && BigInt(redeemFee.flatRedeemFee) > 0n ? "text-txt" : "text-emerald")}>
              {redeemFee && BigInt(redeemFee.flatRedeemFee) > 0n
                ? `net − ${formatUsdgFee(redeemFee.flatRedeemFee, redeemFee.feeDecimals)} USDG`
                : "$0.00"}
            </span>
          </div>
        </div>
      ) : (
        <div className={RAIL_SEC}>
          <div className={LAB}>Method</div>
          <RadioCards options={redeemOptions} value={method} onValueChange={(v) => setMethod(v as RedeemMethod)} />
        </div>
      )}

      <div className="px-3.5 py-3">
        {activeGate.enabled ? (
          <Button
            variant="primary"
            full
            onClick={handleRedeem}
            disabled={running}
            aria-label="Redeem basket tokens"
            className="py-3"
          >
            {running ? "Redeeming…" : effectiveMethod === "inkind" ? "Redeem in-kind" : "Queue cash redeem"}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button full disabled aria-label="Redeem basket tokens" className="py-3">
              {effectiveMethod === "inkind" ? "Redeem in-kind" : "Queue cash redeem"}
            </Button>
            <GateBanner gate={activeGate} />
          </div>
        )}
        {tx.total > 0 && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-txt3">
            <span>{currentLabel ?? (tx.status === "success" ? "Confirmed ✓" : "Working…")}</span>
            <span>
              {Math.min(tx.currentStep + (running ? 1 : 0), tx.total)} / {tx.total}
            </span>
          </div>
        )}
        {tx.status === "success" && (
          <div className="mt-2 flex flex-col gap-1 text-xs" aria-label="transaction status">
            <span className="text-emerald">Confirmed ✓</span>
          </div>
        )}
        {tx.error && (
          <div className="mt-2 flex flex-col gap-1 text-xs" aria-label="transaction status">
            <span className="text-red">Failed: {tx.error}</span>
          </div>
        )}
      </div>
    </>
  );
}

const DIRECTIONS: { value: Direction; label: string }[] = [
  { value: "mint", label: "Buy / Mint" },
  { value: "redeem", label: "Redeem" },
];

export function OrderRail({
  vaultAddress,
  basket,
  nav,
  rebalance,
  direction: directionProp,
  onDirectionChange,
  redeemMethod,
  onRedeemMethodChange,
}: Props & {
  direction?: Direction;
  onDirectionChange?: (d: Direction) => void;
  redeemMethod?: RedeemMethod;
  onRedeemMethodChange?: (m: RedeemMethod) => void;
}) {
  const [localDir, setLocalDir] = useState<Direction>("mint");
  const direction = directionProp ?? localDir;
  const setDirection = onDirectionChange ?? setLocalDir;
  // Registry create/redeem route to forward cash (no in-kind surface yet).
  const isRegistry = basket.vaultType === "registry";
  return (
    <aside
      className="w-[332px] shrink-0 flex flex-col overflow-y-auto border-l border-line bg-bg2"
      aria-label="Order panel"
    >
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-line">
        <span className="text-[12px] font-bold tracking-[0.03em]">ORDER RAIL</span>
        <span className="font-mono text-[10px] text-txt3">{basket.symbol}</span>
        <span className="ml-auto font-mono text-[8.5px] tracking-[0.08em] uppercase px-1.5 py-0.5 rounded bg-cyan/[0.12] text-cyan">
          {isRegistry ? "Forward cash" : "In-kind mint"}
        </span>
      </div>

      <div className={RAIL_SEC}>
        <div className="flex border border-line rounded-md overflow-hidden bg-surface2">
          {DIRECTIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => setDirection(d.value)}
              aria-pressed={direction === d.value}
              className={cn(
                "flex-1 py-1.5 text-[11px] border-r border-line last:border-r-0 transition-colors",
                direction === d.value ? "bg-cyan text-[#06080a] font-semibold" : "text-txt2 hover:bg-surface3 hover:text-txt",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {direction === "mint" &&
        (isRegistry ? (
          <RegistryCreatePanel vaultAddress={vaultAddress} basket={basket} nav={nav} rebalance={rebalance} />
        ) : (
          <CreatePanel vaultAddress={vaultAddress} basket={basket} nav={nav} rebalance={rebalance} />
        ))}
      {direction === "redeem" && (
        <RedeemPanel
          vaultAddress={vaultAddress}
          basket={basket}
          nav={nav}
          method={redeemMethod}
          onMethodChange={onRedeemMethodChange}
        />
      )}
    </aside>
  );
}
