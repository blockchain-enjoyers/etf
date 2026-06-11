import { cn } from "../lib/cn";

interface WarningBannerProps {
  children: React.ReactNode;
  className?: string;
}

export function WarningBanner({ children, className }: WarningBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-amber/30 bg-amber/[0.06] px-3 py-2 text-[12px] text-amber",
        className
      )}
    >
      <span aria-hidden="true">⚠</span>
      <span>{children}</span>
    </div>
  );
}
