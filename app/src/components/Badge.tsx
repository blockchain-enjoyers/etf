import { cn } from "../lib/cn";

type BadgeVariant = "default" | "positive" | "negative" | "warning";

const variantClass: Record<BadgeVariant, string> = {
  default: "border border-line bg-surface2 text-txt2",
  positive: "border border-emerald/30 bg-emerald/[0.07] text-emerald",
  negative: "border border-red/30 bg-red/[0.07] text-red",
  warning: "border border-amber/30 bg-amber/[0.07] text-amber",
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide",
        variantClass[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
