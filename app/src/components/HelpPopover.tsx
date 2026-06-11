import { useState, useId, useRef, useEffect, type ReactNode } from "react";
import { cn } from "../lib/cn";

interface Props {
  brief?: ReactNode;
  extended?: ReactNode;
  example?: ReactNode;
}

export function HelpPopover({ brief, extended, example }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const hasMore = Boolean(extended || example);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="group relative inline-grid place-items-center align-middle">
      <button
        type="button"
        aria-label="Help"
        aria-expanded={open}
        aria-describedby={id}
        onClick={() => hasMore && setOpen((v) => !v)}
        className="w-3.5 h-3.5 rounded-full border border-line text-txt3 text-[9px] font-mono hover:border-cyan hover:text-cyan cursor-help"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className={cn(
          "absolute bottom-[130%] left-1/2 -translate-x-1/2 w-60 rounded-md border border-cyan-dim bg-[#06080a] px-2.5 py-2 text-[10.5px] leading-snug text-txt text-left z-40 shadow-xl normal-case tracking-normal font-sans",
          open ? "opacity-100 visible" : "opacity-0 invisible group-hover:opacity-100 group-hover:visible pointer-events-none",
        )}
      >
        <span className="block">{brief}</span>
        {hasMore && !open && <span className="block mt-1 text-[9px] text-cyan">click for an example →</span>}
        {open && (
          <span className="block mt-2 pt-2 border-t border-line-soft">
            {extended && <span className="block text-txt2">{extended}</span>}
            {example && (
              <span className="block mt-1.5 text-[10px] text-txt2">
                <b className="text-cyan">Example</b> {example}
              </span>
            )}
          </span>
        )}
      </span>
    </span>
  );
}
