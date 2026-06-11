import { cn } from "../lib/cn";

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message = "Something went wrong", onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center justify-center gap-2 py-12 text-center", className)}
    >
      <span className="text-[13px] text-red">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-[13px] text-cyan underline hover:opacity-70"
        >
          Retry
        </button>
      )}
    </div>
  );
}
