import { cn } from "../lib/cn";

interface ConfidenceBandProps {
  widthPct: number;
  className?: string;
  "aria-label"?: string;
}

export function ConfidenceBand({ widthPct, className, "aria-label": ariaLabel }: ConfidenceBandProps) {
  const clamped = Math.max(0, Math.min(100, widthPct));
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? "confidence band"}
      className={cn("relative h-1.5 w-full rounded bg-surface3", className)}
    >
      <div
        style={{ width: `${clamped}%` }}
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 rounded bg-cyan opacity-30"
      />
    </div>
  );
}
