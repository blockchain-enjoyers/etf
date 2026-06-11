import { cn } from "../lib/cn";
import type { Gate, Reason } from "../capabilities/use-capabilities";

type Tone = "amber" | "red" | "cyan";
const DECODE: Record<Exclude<Reason, "ok">, { meaning: string; fix: string; tone: Tone }> = {
  "wallet-disconnected": { meaning: "No wallet attached.", fix: "Connect your wallet.", tone: "amber" },
  "wrong-chain": { meaning: "Wallet is on another network.", fix: "Switch to Robinhood Chain.", tone: "amber" },
  "market-closed": { meaning: "Stocks aren't trading.", fix: "Cash ops wait for next open; in-kind still works.", tone: "cyan" },
  "manager-mismatch": { meaning: "Manager-only tool.", fix: "Sign in as the index manager.", tone: "amber" },
  frozen: { meaning: "This basket is frozen.", fix: "Only in-kind redeem stays open.", tone: "red" },
  "not-deployed": { meaning: "Vault isn't deployed yet.", fix: "Nothing to trade until launch.", tone: "red" },
};
const TONE: Record<Tone, string> = {
  amber: "border-amber/30 bg-amber/[0.06]",
  red: "border-red/30 bg-red/[0.06]",
  cyan: "border-cyan-dim bg-cyan/[0.05]",
};
const ICON: Record<Tone, string> = { amber: "⚑", red: "⊘", cyan: "ⓘ" };

export function GateBanner({ gate, className }: { gate: Gate; className?: string }) {
  if (gate.enabled || gate.reason === "ok") return null;
  const d = DECODE[gate.reason];
  return (
    <div className={cn("flex items-start gap-2.5 px-2.5 py-2 rounded-md border text-[11.5px]", TONE[d.tone], className)}>
      <span className="mt-px">{ICON[d.tone]}</span>
      <div>
        <b className="font-semibold">{d.meaning}</b>
        <div className="text-txt2 mt-0.5">{d.fix}</div>
      </div>
    </div>
  );
}
