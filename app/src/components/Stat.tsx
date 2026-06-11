import { cn } from "../lib/cn";

interface StatProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}

export function Stat({ label, value, sub, className }: StatProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[9.5px] uppercase tracking-wider text-txt3">{label}</span>
      <span className="font-mono text-[20px] font-semibold leading-none tabular-nums text-txt">{value}</span>
      {sub && <span className="text-[11px] text-txt2">{sub}</span>}
    </div>
  );
}
