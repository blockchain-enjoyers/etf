import { cn } from "../lib/cn";

interface Segment {
  label: string;
  weight: number;
}

interface WeightBarProps {
  segments: Segment[];
  className?: string;
}

export function WeightBar({ segments, className }: WeightBarProps) {
  const total = segments.reduce((sum, s) => sum + s.weight, 0);
  return (
    <div
      role="img"
      aria-label="weight distribution"
      className={cn("flex h-2 w-full overflow-hidden rounded bg-surface3", className)}
    >
      {segments.map((seg, i) => (
        <div
          key={`${seg.label}-${i}`}
          title={`${seg.label}: ${((seg.weight / total) * 100).toFixed(1)}%`}
          style={{ width: `${(seg.weight / total) * 100}%` }}
          className="h-full bg-cyan odd:opacity-60 even:opacity-100"
        />
      ))}
    </div>
  );
}
