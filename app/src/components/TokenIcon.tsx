import { cn } from "../lib/cn";

interface TokenIconProps {
  token: string;
  symbol?: string;
  size?: number;
  className?: string;
}

// Small, high-contrast palette echoing the #3 mockup's `.ticon` squares.
const PALETTE = ["#35d0e0", "#28e07b", "#9a7bff", "#ffb020", "#ff5263", "#f7931a", "#76b900", "#3b82f6"];

// Deterministic FNV-ish hash via Math.imul (NOT Math.random) so the colour is stable per token.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function TokenIcon({ token, symbol, size = 18, className }: TokenIconProps) {
  const basis = (symbol || token).toLowerCase();
  const color = PALETTE[hash(basis) % PALETTE.length];
  const raw = symbol || token.replace(/^0x/i, "");
  const label = raw.slice(0, 2).toUpperCase();

  return (
    <span
      aria-hidden="true"
      className={cn("inline-grid place-items-center rounded font-mono font-bold shrink-0", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        background: color,
        color: "#06080a",
      }}
    >
      {label}
    </span>
  );
}
