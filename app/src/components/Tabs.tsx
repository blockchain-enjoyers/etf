import { Tabs as RadixTabs } from "radix-ui";
import { cn } from "../lib/cn";

export interface TabItem {
  value: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  items: TabItem[];
  defaultValue?: string;
  className?: string;
}

export function Tabs({ items, defaultValue, className }: TabsProps) {
  return (
    <RadixTabs.Root defaultValue={defaultValue ?? items[0]?.value} className={cn("flex flex-col gap-2", className)}>
      <RadixTabs.List
        aria-label="tabs"
        className="flex gap-0 border-b border-line"
      >
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className={cn(
              "border-b-2 border-transparent px-3 py-1.5 text-[13px] text-txt2 transition-colors hover:text-txt",
              "data-[state=active]:border-cyan data-[state=active]:text-cyan"
            )}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value}>
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
