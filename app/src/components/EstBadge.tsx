import { cn } from "../lib/cn";

interface EstBadgeProps {
  className?: string;
}

export function EstBadge({ className }: EstBadgeProps) {
  return (
    <span
      aria-label="estimated"
      className={cn(
        "inline-flex items-center rounded border border-amber/30 bg-amber/[0.07] px-1 font-mono text-[9px] tracking-wide text-amber",
        className
      )}
    >
      ~est
    </span>
  );
}
