export function formatTokenAmount(amount: bigint, decimals: number, symbol: string): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = amount % base;
  const fracStr = frac === 0n ? "" : "." + (frac * 100n / base).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole.toString()}${fracStr} ${symbol}`;
}

export function approveSummary(amount: bigint, decimals: number, symbol: string, spenderLabel: string): string {
  return `Approve ${spenderLabel} to pull ${formatTokenAmount(amount, decimals, symbol)}`;
}

export function mintSummary(units: bigint, basketSymbol: string): string {
  return `Mint ${formatTokenAmount(units, 18, basketSymbol)} (in-kind)`;
}
