const EXPLORER_TX = "https://explorer.testnet.chain.robinhood.com/tx/";

interface TxStatusProps {
  hash?: `0x${string}`;
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error?: Error | null;
  idleHidden?: boolean;
}

function shortMessage(error: Error): string {
  const firstLine = error.message.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 120 ? firstLine.slice(0, 120) + "…" : firstLine;
}

export function TxStatus({
  hash,
  isPending,
  isConfirming,
  isSuccess,
  error,
}: TxStatusProps) {
  const idle = !hash && !isPending && !isConfirming && !isSuccess && !error;
  if (idle) return null;

  // Priority: error > success > confirming > pending.
  const label = error
    ? `Failed: ${shortMessage(error)}`
    : isSuccess
      ? "Confirmed ✓"
      : isConfirming
        ? "Confirming…"
        : isPending
          ? "Submitting…"
          : null;

  if (!label && !hash) return null;

  return (
    <div className="flex flex-col gap-1 text-xs" aria-label="transaction status">
      {label && (
        <span className={error ? "text-[var(--color-danger,#c0392b)]" : "text-[var(--color-ink)]"}>
          {label}
        </span>
      )}
      {hash && (
        <a
          className="text-[var(--color-muted)] underline truncate hover:text-[var(--color-ink)]"
          href={`${EXPLORER_TX}${hash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {hash}
        </a>
      )}
    </div>
  );
}
