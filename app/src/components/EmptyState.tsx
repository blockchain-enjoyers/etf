import { cn } from "../lib/cn";

interface EmptyStateProps {
  message: string;
  className?: string;
}

export function EmptyState({ message, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}
    >
      <span className="text-[13px] text-txt2">{message}</span>
    </div>
  );
}
