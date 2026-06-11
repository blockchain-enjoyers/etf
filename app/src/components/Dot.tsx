import { cn } from "../lib/cn";

type DotVariant = "open" | "closed" | "halt";

const variantClass: Record<DotVariant, string> = {
  open: "bg-emerald shadow-[0_0_9px_#28e07b]",
  closed: "bg-amber",
  halt: "bg-red",
};

interface DotProps {
  variant: DotVariant;
  className?: string;
}

export function Dot({ variant, className }: DotProps) {
  return (
    <span
      role="img"
      aria-label={variant}
      data-testid={`dot-${variant}`}
      className={cn("inline-block h-2 w-2 rounded-full", variantClass[variant], className)}
    />
  );
}
