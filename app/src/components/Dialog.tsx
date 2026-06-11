import { Dialog as RadixDialog } from "radix-ui";
import { cn } from "../lib/cn";

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onOpenChange, trigger, title, description, children, className }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <RadixDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-lg",
            className
          )}
        >
          <RadixDialog.Title className="mb-1 text-[15px] font-semibold text-[var(--color-ink)]">
            {title}
          </RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mb-4 text-[13px] text-[var(--color-muted)]">
              {description}
            </RadixDialog.Description>
          )}
          {children}
          <RadixDialog.Close
            aria-label="close dialog"
            className="absolute right-3 top-3 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            ✕
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
