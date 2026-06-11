import { cn } from "../lib/cn";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-busy="true"
      aria-label="loading"
      className={cn("animate-pulse rounded bg-surface2", className)}
    />
  );
}
