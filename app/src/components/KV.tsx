import { cn } from "../lib/cn";

interface KVProps {
  label: string;
  value: React.ReactNode;
  className?: string;
}

export function KV({ label, value, className }: KVProps) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-b border-line-soft py-1.5 text-[11.5px] last:border-b-0",
        className
      )}
    >
      <span className="text-txt2">{label}</span>
      <span className="font-mono font-semibold tabular-nums text-txt">{value}</span>
    </div>
  );
}
