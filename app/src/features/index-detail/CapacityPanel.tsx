import { formatUnits } from "viem";
import type { QueueCapacity } from "@meridian/sdk";
import { Module } from "../../components/Module";

interface Props {
  capacity: QueueCapacity;
}

export function CapacityPanel({ capacity }: Props) {
  const uncapped = capacity.maxCreateFlowBps === 0 || capacity.windowCapShares === null;
  const usedPct =
    !uncapped && capacity.windowCapShares
      ? Math.min(
          100,
          Number((BigInt(capacity.pendingRedeemShares) * 100n) / (BigInt(capacity.windowCapShares) || 1n)),
        )
      : 0;

  return (
    <Module
      title="Create capacity"
      audience="ap"
      help="Each settlement window has a create cap to protect the vault. Flow beyond the cap is partially filled pro-rata and rolls over to the next window — your escrow stays cancelable."
    >
      <div className="flex flex-col gap-px">
        <div className="flex items-center justify-between py-1.5 border-b border-line-soft text-[11.5px]">
          <span className="text-txt2">Cap (per window)</span>
          <span className="font-mono font-semibold tabular-nums">
            {uncapped ? "Unlimited" : `${formatUnits(BigInt(capacity.windowCapShares ?? "0"), 18)} shares`}
          </span>
        </div>
        <div className="flex items-center justify-between py-1.5 border-b border-line-soft text-[11.5px]">
          <span className="text-txt2">Pending create</span>
          <span className="font-mono font-semibold tabular-nums">
            {formatUnits(BigInt(capacity.pendingCreateCash), 6)} USDC
          </span>
        </div>
        <div className="flex items-center justify-between py-1.5 text-[11.5px]">
          <span className="text-txt2">Pending redeem</span>
          <span className="font-mono font-semibold tabular-nums">
            {formatUnits(BigInt(capacity.pendingRedeemShares), 18)} shares
          </span>
        </div>
      </div>

      {!uncapped && (
        <div className="mt-2 h-1.5 rounded bg-surface3 overflow-hidden">
          <span className="block h-full rounded bg-violet" style={{ width: `${usedPct}%` }} />
        </div>
      )}

      <p className="mt-2 text-[10.5px] text-txt3 leading-relaxed">
        {uncapped
          ? "No per-window create cap is set."
          : `Cap is ${capacity.maxCreateFlowBps} bps of supply. Create flow beyond the cap is partially filled pro-rata and rolls over to the next window (your escrow stays cancelable).`}
      </p>
    </Module>
  );
}
