import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { parseUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { buildEnableCashSettlementTypedData } from "@meridian/sdk";
import type { EnableParams } from "@meridian/sdk";
import { useApi } from "../../lib/api";
import { queryKeys } from "../../lib/query";
import { APP_CHAIN_ID } from "../../lib/wagmi";
import { useForwardEnableStatus } from "../../data/useForwardEnableStatus";

interface Props {
  vault: string;
  manager: string;
}

interface RawForm {
  minPrints: string;
  twapWindowSec: string;
  twapBandBps: string;
  pegBandBps: string;
  pegMaxAgeSec: string;
  cutoffDelaySec: string;
  spreadBps: string;
  capacityBps: string;
  keeperTip: string;
  keeperBps: string;
}

const DEFAULTS: RawForm = {
  minPrints: "2",
  twapWindowSec: "600",
  twapBandBps: "200",
  pegBandBps: "200",
  pegMaxAgeSec: "3600",
  cutoffDelaySec: "600",
  spreadBps: "0",
  capacityBps: "0",
  keeperTip: "0",
  keeperBps: "0",
};

const FIELDS: { key: keyof RawForm; label: string; hint: string }[] = [
  { key: "minPrints", label: "Min prints", hint: "≥ 2" },
  { key: "twapWindowSec", label: "TWAP window (s)", hint: "60–86400" },
  { key: "twapBandBps", label: "TWAP band (bps)", hint: "10–2000" },
  { key: "pegBandBps", label: "Peg band (bps)", hint: "10–2000" },
  { key: "pegMaxAgeSec", label: "Peg max age (s)", hint: "60–86400" },
  { key: "cutoffDelaySec", label: "Cutoff delay (s)", hint: "600–604800" },
  { key: "spreadBps", label: "Spread (bps)", hint: "0–200" },
  { key: "capacityBps", label: "Capacity (bps)", hint: "0–10000" },
  { key: "keeperTip", label: "Keeper tip (USDG)", hint: "≤ 100 USDG" },
  { key: "keeperBps", label: "Keeper (bps)", hint: "0–2000" },
];

function short(addr?: string): string {
  if (!addr) return "—";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function buildParams(raw: RawForm): EnableParams {
  return {
    minPrints: Number(raw.minPrints),
    twapWindowSec: Number(raw.twapWindowSec),
    twapBandBps: Number(raw.twapBandBps),
    pegBandBps: Number(raw.pegBandBps),
    pegMaxAgeSec: Number(raw.pegMaxAgeSec),
    cutoffDelaySec: Number(raw.cutoffDelaySec),
    spreadBps: Number(raw.spreadBps),
    capacityBps: Number(raw.capacityBps),
    keeperTip: parseUnits(raw.keeperTip || "0", 18).toString(),
    keeperBps: Number(raw.keeperBps),
  };
}

export function EnableCashSettlementPanel({ vault, manager }: Props) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const api = useApi();
  const qc = useQueryClient();

  const [raw, setRaw] = useState<RawForm>(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const { data: status } = useForwardEnableStatus(vault, true);

  if (!address || address.toLowerCase() !== manager.toLowerCase()) return null;

  const st = retrying ? undefined : status?.status;

  async function onSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const params = buildParams(raw);
      const nonce = BigInt(Date.now());
      const expiry = Math.floor(Date.now() / 1000) + 600;
      const td = buildEnableCashSettlementTypedData(
        vault as `0x${string}`,
        params,
        nonce,
        BigInt(expiry),
        APP_CHAIN_ID,
      );
      const signature = await signTypedDataAsync(td as Parameters<typeof signTypedDataAsync>[0]);
      await api.enableCashSettlement(vault, { params, nonce: nonce.toString(), expiry, signature });
      qc.invalidateQueries({ queryKey: queryKeys.forwardEnableStatus(vault) });
      setRetrying(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (st === "live") {
    return (
      <div className="px-3 py-3 text-xs">
        <p className="text-txt">Cash settlement enabled.</p>
        <p className="text-txt2 mt-1">
          Forward queue:{" "}
          <span className="font-mono tabular-nums text-txt">{short(status?.queueAddress)}</span>
        </p>
      </div>
    );
  }

  if (st === "pending" || st === "wiring") {
    return (
      <div className="px-3 py-3 text-xs text-txt2">
        Enabling… {status?.step ? `(${status.step})` : null}
      </div>
    );
  }

  if (st === "failed") {
    return (
      <div className="px-3 py-3 text-xs">
        <p className="text-amber">{status?.error ?? "Enable failed."}</p>
        <button
          type="button"
          className="mt-2 border border-line px-3 py-1 text-txt hover:text-txt2"
          onClick={() => {
            setRetrying(true);
            setSubmitError(null);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 text-xs">
      <p className="text-txt2 mb-3">
        Configure and sign the cash-settlement parameters. Your signature authorizes the platform to
        wire the forward queue — no on-chain transaction is sent from here.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-0.5">
            <span className="text-txt3 text-[10px] uppercase tracking-wide">{f.label}</span>
            <input
              className="border border-line bg-transparent px-2 py-1 font-mono tabular-nums text-txt"
              type={f.key === "keeperTip" ? "text" : "number"}
              value={raw[f.key]}
              onChange={(e) => setRaw((r) => ({ ...r, [f.key]: e.target.value }))}
            />
            <span className="text-txt3 text-[10px]">{f.hint}</span>
          </label>
        ))}
      </div>

      {submitError && <p className="text-amber mt-2">{submitError}</p>}

      <button
        type="button"
        className="mt-3 border border-line px-3 py-1.5 text-txt hover:text-txt2 disabled:opacity-50"
        disabled={submitting}
        onClick={onSubmit}
      >
        {submitting ? "Signing…" : "Enable cash settlement"}
      </button>
    </div>
  );
}
