import { cn } from "../lib/cn";

export interface StepChip {
  label: string;
  active: boolean;
}

interface StepChipsProps {
  chips: StepChip[];
  className?: string;
}

export function StepChips({ chips, className }: StepChipsProps) {
  return (
    <div role="list" className={cn("flex flex-wrap gap-2", className)}>
      {chips.map((chip) => (
        <span
          key={chip.label}
          role="listitem"
          aria-selected={chip.active}
          className={cn(
            "rounded-full px-3 py-1 text-[12px] font-medium",
            chip.active
              ? "bg-cyan font-semibold text-[#06080a]"
              : "border border-line bg-surface2 text-txt2"
          )}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}
