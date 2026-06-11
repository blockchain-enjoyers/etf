import { Tooltip as RadixTooltip } from "radix-ui";
import { cn } from "../lib/cn";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <RadixTooltip.Provider>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={4}
            className={cn(
              "z-50 rounded-md border border-cyan-dim bg-[#06080a] px-2.5 py-2 text-[10.5px] leading-snug text-txt shadow-xl",
              className
            )}
          >
            {content}
            <RadixTooltip.Arrow className="fill-cyan-dim" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
