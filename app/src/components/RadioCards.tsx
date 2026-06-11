import { RadioGroup } from "radix-ui";
import { cn } from "../lib/cn";

export interface RadioCardOption {
  value: string;
  label: string;
  description?: string;
}

interface RadioCardsProps {
  options: RadioCardOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  className?: string;
}

export function RadioCards({ options, value, onValueChange, name, className }: RadioCardsProps) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={onValueChange}
      name={name}
      className={cn("flex flex-col gap-2", className)}
    >
      {options.map((opt) => (
        <RadioGroup.Item
          key={opt.value}
          value={opt.value}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-txt3",
            "data-[state=checked]:border-cyan data-[state=checked]:bg-surface2"
          )}
        >
          <RadioGroup.Indicator className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border-2 border-cyan after:block after:h-2 after:w-2 after:rounded-full after:bg-cyan" />
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-txt">{opt.label}</span>
            {opt.description && (
              <span className="text-[12px] text-txt2">{opt.description}</span>
            )}
          </div>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
