import { cn } from "../lib/cn";

interface PillProps {
  children: React.ReactNode;
  className?: string;
}

export function Pill({ children, className }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-line bg-surface2 px-2 py-0.5 font-mono text-[10px] tracking-wide text-txt2",
        className
      )}
    >
      {children}
    </span>
  );
}
