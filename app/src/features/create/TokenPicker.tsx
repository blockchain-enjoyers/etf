import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTokenSearch } from "../../data/useTokenSearch";
import { useResolveToken } from "../../data/useResolveToken";
import { cn } from "../../lib/cn";

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const inputCls = "border border-line bg-surface text-txt font-mono text-sm px-2 py-1 rounded-md focus:outline-none focus:border-cyan";

interface Props {
  value: string;
  onChange: (token: string) => void;
  id?: string;
}

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function TokenPicker({ value, onChange, id }: Props) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isResolved = ADDR.test(value);

  const resolve = useResolveToken(isResolved ? value : "");
  const search = useTokenSearch(isResolved ? "" : text);

  const open = !isResolved && focused && text.trim().length >= 1;

  // Anchor the dropdown to the input in viewport coords (portaled to <body> so no parent
  // overflow can clip it). Reposition while open on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  if (isResolved) {
    const info = resolve.data;
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono text-xs text-txt3">{short(value)}</span>
        {info ? (
          <span className="text-txt2 truncate">
            <span className="font-semibold text-txt">{info.symbol}</span>
            {info.name && <span className="text-txt3"> — {info.name}</span>}
          </span>
        ) : (
          <span className="text-txt3">{resolve.isLoading ? "resolving…" : ""}</span>
        )}
        <button
          type="button"
          aria-label="Change token"
          className="ml-auto text-[10px] text-txt3 border border-line bg-surface2 rounded px-1.5 py-0.5 hover:border-cyan hover:text-cyan"
          onClick={() => onChange("")}
        >
          ✕ change
        </button>
      </div>
    );
  }

  const pasteAddr = ADDR.test(text.trim());
  const results = search.data ?? [];

  const select = (token: string) => {
    onChange(token);
    setText("");
    setFocused(false);
  };

  return (
    <div>
      <input
        id={id}
        ref={inputRef}
        aria-label="Search token name or ticker"
        autoComplete="off"
        spellCheck={false}
        className={cn(inputCls, "w-full")}
        placeholder="Search name/ticker or paste 0x…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {open &&
        rect &&
        createPortal(
          // onMouseDown preventDefault keeps input focus so the click selects before blur closes.
          <div
            className="fixed z-50 border border-line bg-surface2 rounded-md max-h-56 overflow-auto shadow-lg"
            style={{ left: rect.left, top: rect.top, width: rect.width }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {pasteAddr ? (
              <button
                type="button"
                aria-label={`Use this address: ${text.trim()}`}
                className="w-full text-left px-2.5 py-2 text-sm text-txt hover:bg-surface font-mono"
                onClick={() => select(text.trim().toLowerCase())}
              >
                Use this address: {short(text.trim())}
              </button>
            ) : results.length > 0 ? (
              results.map((r) => (
                <button
                  key={r.token}
                  type="button"
                  aria-label={`Select ${r.symbol}`}
                  className="w-full text-left px-2.5 py-2 text-sm hover:bg-surface flex items-baseline gap-2"
                  onClick={() => select(r.token)}
                >
                  <span className="font-semibold text-txt">{r.symbol}</span>
                  {r.name && <span className="text-txt3 truncate">{r.name}</span>}
                </button>
              ))
            ) : (
              <div className="px-2.5 py-2 text-xs text-txt3">
                {search.isLoading ? "searching…" : "no matches"}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
