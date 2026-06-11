import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type ChipVariant = "ok" | "pend" | "bad" | "info" | "violet" | "neutral";

const SHELL: Record<ChipVariant, string> = {
  ok: "text-emerald border-emerald/30 bg-emerald/[0.07]",
  pend: "text-amber border-amber/30 bg-amber/[0.07]",
  bad: "text-red border-red/30 bg-red/[0.07]",
  info: "text-cyan border-cyan-dim bg-cyan/[0.07]",
  violet: "text-violet border-violet/40 bg-violet/[0.08]",
  neutral: "text-txt2 border-line",
};
const DOT: Record<ChipVariant, string> = {
  ok: "bg-emerald", pend: "bg-amber", bad: "bg-red", info: "bg-cyan", violet: "bg-violet", neutral: "bg-txt3",
};

export function Chip({ variant = "neutral", children, className }: { variant?: ChipVariant; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[10px] px-2 py-0.5 rounded-full border tracking-wide", SHELL[variant], className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", DOT[variant])} />
      {children}
    </span>
  );
}
