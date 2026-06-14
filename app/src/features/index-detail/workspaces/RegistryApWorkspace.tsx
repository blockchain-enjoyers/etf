import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { addresses } from "@meridian/contracts";
import type { BasketDetail } from "@meridian/sdk";
import { Module } from "../../../components/Module";
import { Aud } from "../../../components/Aud";
import { Button } from "../../../components/Button";
import { Chip } from "../../../components/Chip";
import { GateBanner } from "../../../components/GateBanner";
import { AssetFunding } from "../../../components/AssetFunding";
import { EnableCashSettlementPanel } from "../EnableCashSettlementPanel";
import { MyTicketsPanel } from "../MyTicketsPanel";
import { HelpTip } from "../../../components/HelpTip";
import { TokenIcon } from "../../../components/TokenIcon";
import { IconUpload, IconDownload, IconGrid, IconSwap, IconCoins, IconTicket } from "../../../components/icons";
import { cn } from "../../../lib/cn";
import { shortenAddress, formatQty } from "../../../lib/format";
import { queryKeys } from "../../../lib/query";
import { useApi } from "../../../lib/api";
import type { Gate } from "../../../capabilities/use-capabilities";
import { useForwardQueue } from "../../../data/useForwardQueue";
import { useForwardTickets } from "../../../data/useForwardTickets";
import { useTxPlan } from "../../../wallet/use-tx-plan";

// Claim amounts are base-unit strings — parse a human "1.5" into 18-dec base units without viem so
// non-numeric input degrades to 0 rather than throwing.
function toBaseUnits(value: string, decimals = 18): bigint {
  const trimmed = value.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return 0n;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  } catch {
    return 0n;
  }
}

const LAB = "text-[9.5px] uppercase tracking-[0.12em] text-txt3 mb-1.5 flex items-center gap-1.5";
const FIELD =
  "w-full bg-bg border border-line rounded-md font-mono text-[12px] text-txt placeholder:text-txt3 px-2.5 py-2 focus:outline-none focus:border-txt3";

/** Shared tx-status footer (step progress / success / error) matching the order-rail panels. */
function TxStatus({ tx }: { tx: ReturnType<typeof useTxPlan> }) {
  const running = tx.status === "running";
  const currentLabel = tx.steps[tx.currentStep]?.label;
  return (
    <>
      {tx.total > 0 && (
        <div className="flex items-center justify-between text-[11px] text-txt3">
          <span>{currentLabel ?? (tx.status === "success" ? "Confirmed ✓" : "Working…")}</span>
          <span>
            {Math.min(tx.currentStep + (running ? 1 : 0), tx.total)} / {tx.total}
          </span>
        </div>
      )}
      {tx.status === "success" && (
        <div className="text-xs text-emerald" aria-label="transaction status">
          Confirmed ✓
        </div>
      )}
      {tx.error && (
        <div className="text-xs text-red" aria-label="transaction status">
          Failed: {tx.error}
        </div>
      )}
    </>
  );
}

/** A submit button + gate banner that share the AP gate; disabled while a plan runs or input invalid. */
function ActionButton({
  gate,
  label,
  runningLabel,
  running,
  disabled,
  onClick,
  ariaLabel,
}: {
  gate: Gate;
  label: string;
  runningLabel: string;
  running: boolean;
  disabled: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  if (!gate.enabled) {
    return (
      <div className="flex flex-col gap-2">
        <Button full disabled aria-label={ariaLabel}>
          🔒 {label}
        </Button>
        <GateBanner gate={gate} />
      </div>
    );
  }
  return (
    <Button variant="primary" full onClick={onClick} disabled={running || disabled} aria-label={ariaLabel}>
      {running ? runningLabel : label}
    </Button>
  );
}

interface PanelProps {
  vaultAddress: string;
  basket: BasketDetail;
  gate: Gate;
  /** Constituent tokens this vault can custody — drives the token pickers. */
  tokens: { token: string; symbol?: string }[];
}

/** A constituent token picker (defaults to the first constituent) — claims are per-token. */
function TokenSelect({
  tokens,
  value,
  onChange,
  id,
}: {
  tokens: { token: string; symbol?: string }[];
  value: string;
  onChange: (token: string) => void;
  id: string;
}) {
  if (tokens.length === 0) {
    return (
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0x… token address"
        aria-label="token address"
        className={FIELD}
      />
    );
  }
  return (
    <div className="flex items-center gap-2">
      <TokenIcon token={value} symbol={tokens.find((t) => t.token === value)?.symbol} />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="token"
        className={cn(FIELD, "flex-1")}
      >
        {tokens.map((t) => (
          <option key={t.token} value={t.token}>
            {t.symbol ? `${t.symbol} · ${shortenAddress(t.token)}` : shortenAddress(t.token)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Wrap: ERC-20 → ERC-6909 claim. The builder prepends the approve. */
function WrapPanel({ vaultAddress, gate, tokens }: PanelProps) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [token, setToken] = useState(tokens[0]?.token ?? "");
  const [amount, setAmount] = useState("");
  // The approve step targets the underlying token, which isn't in the static address book — seed it.
  const tx = useTxPlan(token ? [token, vaultAddress] : [vaultAddress]);
  const amt = toBaseUnits(amount);

  function handleWrap() {
    if (!token || amt <= 0n || !address) return;
    void tx
      .run(() => api.buildWrapTx(vaultAddress, { account: address, token, amount: amt.toString() }))
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.basket(vaultAddress) });
      });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className={LAB}>Token</div>
        <TokenSelect id="wrap-token" tokens={tokens} value={token} onChange={setToken} />
      </div>
      <div>
        <div className={LAB}>Amount</div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          inputMode="decimal"
          aria-label="wrap amount"
          className={FIELD}
        />
      </div>
      {token && amt > 0n && (
        <AssetFunding account={address} required={[{ token, symbol: tokens.find((t) => t.token === token)?.symbol, amount: amt.toString() }]} />
      )}
      <ActionButton
        gate={gate}
        label="Wrap → claim"
        runningLabel="Wrapping…"
        running={tx.status === "running"}
        disabled={!token || amt <= 0n}
        onClick={handleWrap}
        ariaLabel="Wrap token into claim"
      />
      <TxStatus tx={tx} />
    </div>
  );
}

/** Unwrap: ERC-6909 claim → ERC-20, sent to `to` (defaults to the connected wallet). */
function UnwrapPanel({ vaultAddress, gate, tokens }: PanelProps) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [token, setToken] = useState(tokens[0]?.token ?? "");
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const tx = useTxPlan(token ? [token, vaultAddress] : [vaultAddress]);
  const amt = toBaseUnits(amount);
  const recipient = to.trim() || address || "";

  function handleUnwrap() {
    if (!token || amt <= 0n || !recipient || !address) return;
    void tx
      .run(() => api.buildUnwrapTx(vaultAddress, { account: address, token, amount: amt.toString(), to: recipient }))
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.basket(vaultAddress) });
      });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className={LAB}>Token</div>
        <TokenSelect id="unwrap-token" tokens={tokens} value={token} onChange={setToken} />
      </div>
      <div>
        <div className={LAB}>Amount</div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          inputMode="decimal"
          aria-label="unwrap amount"
          className={FIELD}
        />
      </div>
      <div>
        <div className={LAB}>
          Recipient
          <HelpTip>Where the unwrapped ERC-20 lands. Defaults to your connected wallet.</HelpTip>
        </div>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={address ?? "0x… recipient"}
          aria-label="recipient address"
          className={FIELD}
        />
      </div>
      <ActionButton
        gate={gate}
        label="Unwrap → ERC-20"
        runningLabel="Unwrapping…"
        running={tx.status === "running"}
        disabled={!token || amt <= 0n || !recipient}
        onClick={handleUnwrap}
        ariaLabel="Unwrap claim into token"
      />
      <TxStatus tx={tx} />
    </div>
  );
}

/**
 * Genesis bootstrap: the one-time, Merkle-gated mint that seeds an empty registry index from its
 * genesis basket. The plan auto-approves + wraps each constituent, then calls bootstrap(). Shown only
 * until the vault is seeded; afterwards cash + steady-state AP flows open.
 */
function BootstrapPanel({ vaultAddress, basket, gate }: PanelProps) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const tokens = basket.constituents.map((c) => c.token);
  const tx = useTxPlan([vaultAddress, ...tokens]);

  function handleBootstrap() {
    if (!address || tokens.length === 0) return;
    void tx
      .run(() =>
        api.buildBootstrapTx(vaultAddress, {
          account: address,
          tokens,
          unitQty: basket.constituents.map((c) => c.unitQty),
          unitSize: basket.unitSize,
        }),
      )
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.basket(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.forwardGate(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.nav(vaultAddress) });
      });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11.5px] text-txt2 leading-relaxed">
        This index was created empty. Bootstrap seeds it with one creation unit of the genesis basket —
        it auto-approves and wraps each constituent, then mints the first {basket.symbol}. One-time and
        oracle-free; after this, cash create/redeem opens for everyone.
      </p>
      <div className="flex flex-col gap-1 rounded-md border border-line bg-bg px-2.5 py-2 text-[11px]">
        <span className={LAB}>Genesis basket · per unit</span>
        {basket.constituents.map((c) => (
          <div key={c.token} className="flex items-center justify-between font-mono text-txt2">
            <span>{c.symbol ?? shortenAddress(c.token)}</span>
            <span>{formatQty(c.unitQty)}</span>
          </div>
        ))}
      </div>
      <AssetFunding
        account={address}
        required={basket.constituents.map((c) => ({ token: c.token, symbol: c.symbol, amount: c.unitQty }))}
      />
      <ActionButton
        gate={gate}
        label="Bootstrap (genesis mint)"
        runningLabel="Bootstrapping…"
        running={tx.status === "running"}
        disabled={tokens.length === 0}
        onClick={handleBootstrap}
        ariaLabel="Bootstrap the registry index"
      />
      <TxStatus tx={tx} />
    </div>
  );
}

/** In-kind create: mint N shares; the builder prepends wraps for any per-token claim shortfall. */
function CreatePanel({ vaultAddress, basket, gate }: PanelProps) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [shares, setShares] = useState("");
  const tx = useTxPlan([vaultAddress, ...basket.constituents.map((c) => c.token)]);
  const nShares = toBaseUnits(shares);

  // The create wraps unitQty × units of each constituent (units = shares / unitSize). Surface that as
  // the funding requirement so a short AP can faucet before the create reverts on the wrap.
  const unitSize = BigInt(basket.unitSize || "0");
  const units = unitSize > 0n ? nShares / unitSize : 0n;
  const required =
    units > 0n
      ? basket.constituents.map((c) => ({ token: c.token, symbol: c.symbol, amount: (BigInt(c.unitQty) * units).toString() }))
      : [];

  function handleCreate() {
    if (nShares <= 0n || !address) return;
    void tx
      .run(() => api.buildRegistryCreateTx(vaultAddress, { account: address, nShares: nShares.toString() }))
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.basket(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.nav(vaultAddress) });
      });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className={LAB}>
          Shares to create
          <HelpTip>
            In-kind create against claims. The builder auto-wraps any underlying you&apos;re short on, then mints{" "}
            {basket.symbol}. No oracle, no cash.
          </HelpTip>
        </div>
        <div className="flex items-stretch border border-line rounded-md overflow-hidden bg-bg">
          <input
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="0.0"
            inputMode="decimal"
            aria-label="create shares"
            className="flex-1 bg-transparent font-mono text-[12px] text-txt placeholder:text-txt3 px-2.5 py-2 focus:outline-none"
          />
          <span className="grid place-items-center px-2.5 bg-surface2 text-txt3 font-mono text-[10px] border-l border-line">
            {basket.symbol}
          </span>
        </div>
      </div>
      <p className="text-[10.5px] text-txt3 leading-relaxed">
        In-kind · NAV-free · auto-wraps any claim shortfall before minting.
      </p>
      <AssetFunding account={address} required={required} />
      <ActionButton
        gate={gate}
        label="Create (in-kind)"
        runningLabel="Creating…"
        running={tx.status === "running"}
        disabled={nShares <= 0n}
        onClick={handleCreate}
        ariaLabel="Create shares in-kind"
      />
      <TxStatus tx={tx} />
    </div>
  );
}

/** In-kind redeem: burn shares → claims, optionally chaining unwraps back to ERC-20. */
function RedeemPanel({ vaultAddress, basket, gate }: PanelProps) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const [withUnwrap, setWithUnwrap] = useState(true);
  const tx = useTxPlan([vaultAddress, ...basket.constituents.map((c) => c.token)]);
  const amt = toBaseUnits(amount);

  function handleRedeem() {
    if (amt <= 0n || !address) return;
    void tx
      .run(() => api.buildRegistryRedeemTx(vaultAddress, { account: address, amount: amt.toString(), withUnwrap }))
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.basket(vaultAddress) });
        qc.invalidateQueries({ queryKey: queryKeys.nav(vaultAddress) });
      });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className={LAB}>Shares to redeem</div>
        <div className="flex items-stretch border border-line rounded-md overflow-hidden bg-bg">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            inputMode="decimal"
            aria-label="redeem shares"
            className="flex-1 bg-transparent font-mono text-[12px] text-txt placeholder:text-txt3 px-2.5 py-2 focus:outline-none"
          />
          <span className="grid place-items-center px-2.5 bg-surface2 text-txt3 font-mono text-[10px] border-l border-line">
            {basket.symbol}
          </span>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-txt2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={withUnwrap}
          onChange={(e) => setWithUnwrap(e.target.checked)}
          aria-label="unwrap claims to ERC-20"
          className="accent-cyan"
        />
        Unwrap claims to ERC-20
        <HelpTip>On: receive real tokens. Off: receive bare ERC-6909 claims you can re-wrap or transfer.</HelpTip>
      </label>
      <ActionButton
        gate={gate}
        label="Redeem (in-kind)"
        runningLabel="Redeeming…"
        running={tx.status === "running"}
        disabled={amt <= 0n}
        onClick={handleRedeem}
        ariaLabel="Redeem shares in-kind"
      />
      <TxStatus tx={tx} />
    </div>
  );
}

/** Authorize an ERC-6909 operator — e.g. the forward queue must be an operator to settle cash-in. */
function OperatorPanel({ vaultAddress, gate, defaultOperator }: PanelProps & { defaultOperator: string }) {
  const qc = useQueryClient();
  const api = useApi();
  const { address } = useAccount();
  const [operator, setOperator] = useState(defaultOperator);
  const [approved, setApproved] = useState(true);
  const tx = useTxPlan([vaultAddress]);

  // Seed the operator field once the forward-queue address resolves (it may load after mount).
  useEffect(() => {
    if (defaultOperator) setOperator((cur) => cur || defaultOperator);
  }, [defaultOperator]);

  const operatorValid = /^0x[0-9a-fA-F]{40}$/.test(operator.trim());

  function handleSet() {
    if (!operatorValid || !address) return;
    void tx
      .run(() => api.buildSetOperatorTx(vaultAddress, { account: address, operator: operator.trim(), approved }))
      .then(() => {
        qc.invalidateQueries({ queryKey: queryKeys.basket(vaultAddress) });
      });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className={LAB}>
          Operator
          {defaultOperator && (
            <button
              type="button"
              onClick={() => setOperator(defaultOperator)}
              className="ml-auto font-mono text-[9.5px] text-cyan hover:underline"
            >
              use forward queue
            </button>
          )}
        </div>
        <input
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          placeholder="0x… operator address"
          aria-label="operator address"
          className={FIELD}
        />
        {defaultOperator && (
          <p className="mt-1 text-[10px] text-txt3 font-mono">Forward queue {shortenAddress(defaultOperator)}</p>
        )}
      </div>
      <div className="flex border border-line rounded-md overflow-hidden bg-surface2">
        {[
          { v: true, label: "Authorize" },
          { v: false, label: "Revoke" },
        ].map((o) => (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => setApproved(o.v)}
            aria-pressed={approved === o.v}
            className={cn(
              "flex-1 py-1.5 text-[11px] border-r border-line last:border-r-0 transition-colors",
              approved === o.v ? "bg-cyan text-[#06080a] font-semibold" : "text-txt2 hover:bg-surface3 hover:text-txt",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[10.5px] text-txt3 leading-relaxed">
        Before cash settlement, authorize the forward queue as an operator so it can move your claims on settle.
      </p>
      <ActionButton
        gate={gate}
        label={approved ? "Authorize operator" : "Revoke operator"}
        runningLabel="Submitting…"
        running={tx.status === "running"}
        disabled={!operatorValid}
        onClick={handleSet}
        ariaLabel="Set operator authorization"
      />
      <TxStatus tx={tx} />
    </div>
  );
}

export function RegistryApWorkspace({ vaultAddress, basket }: { vaultAddress: string; basket: BasketDetail }) {
  const enabled = basket.vaultType === "registry";
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  // Registry buy/mint routes to cash (forward queue), so the manager must enable cash settlement here —
  // registry vaults have no Operations tab where that panel otherwise lives.
  const isManager = !!address && !!basket.manager && address.toLowerCase() === basket.manager.toLowerCase();
  // Registry AP actions are claim-lifecycle writes — there's no per-action backend availability flag,
  // so gate purely on wallet+chain presence (the backend-built plan still carries its own gate).
  const wired = isConnected && chainId in addresses;
  const gate: Gate = isConnected
    ? wired
      ? { enabled: true, reason: "ok" }
      : { enabled: false, reason: "wrong-chain" }
    : { enabled: false, reason: "wallet-disconnected" };

  // Forward-queue address (operator default for cash-in settle) — only meaningful for registry.
  const { data: queue } = useForwardQueue(vaultAddress, enabled);
  const forwardQueue = queue?.queueAddress ?? "";
  // Owner-scoped forward tickets so the AP can track + cancel them here (registry has no Operations tab).
  const { data: tickets } = useForwardTickets(vaultAddress, address ?? undefined, enabled);
  const openTickets = (tickets ?? []).filter((t) => t.status === "pending" || t.status === "partial");

  // A fresh registry index is empty until its genesis basket is seeded — surface bootstrap first.
  // `bootstrapped` is the queue-independent on-chain signal (totalSupply > 0) from the basket detail.
  const bootstrapped = basket.bootstrapped !== false;

  const tokens = useMemo(
    () => basket.constituents.map((c) => ({ token: c.token, symbol: c.symbol })),
    [basket.constituents],
  );

  const panelProps: PanelProps = { vaultAddress, basket, gate, tokens };

  return (
    <div className="flex flex-col gap-4" data-workspace="liquidity">
      <div className="flex items-start gap-3 border border-violet/30 rounded-lg bg-gradient-to-r from-surface2 to-surface px-3.5 py-3">
        <div className="grid place-items-center w-8 h-8 rounded-md bg-violet/[0.12] text-violet shrink-0">💧</div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Liquidity — Authorized Participant workspace</h2>
          <p className="text-[11.5px] text-txt2 mt-0.5">
            For liquidity providers: this registry index custodies its constituents as ERC-6909 claims. APs wrap
            tokens into claims, create and redeem {basket.symbol} in-kind, and authorize the forward queue to settle
            cash flows. Retail create/redeem still routes to cash in the Trade tab — most holders never need this.
          </p>
        </div>
        <Aud role="ap" className="shrink-0" />
      </div>

      {!gate.enabled && <GateBanner gate={gate} />}

      {!bootstrapped && (
        <div className="rounded-lg border border-cyan-dim bg-cyan/[0.05] p-px">
          <Module
            title="Bootstrap — genesis mint"
            icon={<IconGrid />}
            audience="ap"
            help="One-time genesis seed for a fresh registry index: auto-approves + wraps the genesis basket, then mints the first shares (Merkle-proof-gated). Cash and steady-state AP flows stay locked until this lands."
          >
            <BootstrapPanel {...panelProps} />
          </Module>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Module
          title="Wrap → claim"
          icon={<IconUpload />}
          audience="ap"
          help="Deposit an underlying ERC-20 and receive the vault's ERC-6909 claim for it. Approve is prepended automatically. Claims are what the vault mints against."
        >
          <WrapPanel {...panelProps} />
        </Module>

        <Module
          title="Unwrap → ERC-20"
          icon={<IconDownload />}
          audience="ap"
          help="Burn a claim back to the underlying ERC-20, sent to any address (defaults to you)."
        >
          <UnwrapPanel {...panelProps} />
        </Module>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Module
          title="Create in-kind"
          icon={<IconGrid />}
          audience="ap"
          help="Mint shares against claims. The builder wraps any per-token shortfall first, then mints — oracle-free, like every in-kind create."
        >
          <CreatePanel {...panelProps} />
        </Module>

        <Module
          title="Redeem in-kind"
          icon={<IconSwap />}
          audience="ap"
          help="Burn shares for the underlying claims pro-rata, optionally unwrapping them to ERC-20 in the same transaction. Unconditional — never paused."
        >
          <RedeemPanel {...panelProps} />
        </Module>
      </div>

      <Module
        title="Authorize operator"
        icon={<IconCoins />}
        audience="ap"
        help="ERC-6909 operator approval. The forward cash queue must be your operator before it can settle a cash-in by moving your claims. Defaults to the vault's forward queue."
      >
        <OperatorPanel {...panelProps} defaultOperator={forwardQueue} />
      </Module>

      <Module
        title="Open tickets"
        icon={<IconTicket />}
        audience="ap"
        help="Queued cash flows waiting to settle at the next market open. Pending tickets can be cancelled here — the escrowed USDG is refunded."
        right={<Chip variant={openTickets.length > 0 ? "violet" : "neutral"}>{openTickets.length} open</Chip>}
      >
        <MyTicketsPanel vaultAddress={vaultAddress} tickets={tickets ?? []} />
      </Module>

      {isManager && (
        <Module
          title="Enable cash settlement"
          icon={<IconCoins />}
          audience="curator"
          help="Manager-only: sign the cash-settlement parameters to wire this index's forward queue. Until enabled, USDG buy/mint and cash redeem can't settle (the queue doesn't exist yet)."
        >
          <EnableCashSettlementPanel vault={vaultAddress} manager={basket.manager!} />
        </Module>
      )}
    </div>
  );
}
