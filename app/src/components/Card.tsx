import { cn } from "../lib/cn";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface p-4",
        className
      )}
    >
      {children}
    </div>
  );
}
