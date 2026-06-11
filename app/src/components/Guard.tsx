import { cn } from "../lib/cn";
import { Chip } from "./Chip";

type GuardStatus = "pass" | "pend" | "bad";
const ICON: Record<GuardStatus, string> = { pass: "✓", pend: "◷", bad: "✕" };
const ICOBG: Record<GuardStatus, string> = {
  pass: "bg-emerald/[0.12] text-emerald",
  pend: "bg-amber/[0.12] text-amber",
  bad: "bg-red/[0.12] text-red",
};
const CHIP: Record<GuardStatus, "ok" | "pend" | "bad"> = { pass: "ok", pend: "pend", bad: "bad" };

export function Guard({ status, title, detail, code }: { status: GuardStatus; title: string; detail: string; code?: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-line-soft last:border-b-0">
      <span className={cn("w-5.5 h-5.5 rounded-md grid place-items-center", ICOBG[status])}>{ICON[status]}</span>
      <div className="flex-1">
        <div className="text-xs font-semibold flex items-center gap-1.5">
          {title}
          {code && <span className="font-mono text-[9px] text-txt3 bg-surface3 px-1.5 rounded border border-line">{code}</span>}
        </div>
        <div className="text-[10.5px] text-txt3 mt-px">{detail}</div>
      </div>
      <Chip variant={CHIP[status]}>{status === "pass" ? "PASS" : status === "pend" ? "PENDING" : "BLOCKED"}</Chip>
    </div>
  );
}
