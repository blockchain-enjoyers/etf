import { useState, useId, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

interface Props {
  brief?: ReactNode;
  extended?: ReactNode;
  example?: ReactNode;
}

const W = 240; // tooltip width (px); kept in sync with the inline `width` so the clamp math holds

export function HelpPopover({ brief, extended, example }: Props) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, below: false });
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMore = Boolean(extended || example);
  const show = open || hover;

  const enter = () => {
    if (timer.current) clearTimeout(timer.current);
    setHover(true);
  };
  const leave = () => {
    timer.current = setTimeout(() => setHover(false), 120);
  };

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 200;
    const cx = r.left + r.width / 2;
    const left = Math.min(Math.max(cx, W / 2 + 8), window.innerWidth - W / 2 - 8);
    setPos({ top: below ? r.bottom + 8 : r.top - 8, left, below });
  };

  useLayoutEffect(() => {
    if (show) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, open]);

  useEffect(() => {
    if (!show) return;
    const reposition = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (triggerRef.current?.contains(t)) return;
      if (t?.closest?.("[data-help-pop]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Help"
        aria-expanded={open}
        aria-describedby={id}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onClick={() => hasMore && setOpen((v) => !v)}
        className="inline-grid place-items-center align-middle w-3.5 h-3.5 rounded-full border border-line text-txt3 text-[9px] font-mono hover:border-cyan hover:text-cyan cursor-help"
      >
        ?
      </button>
      {createPortal(
        <span
          id={id}
          role="tooltip"
          data-help-pop=""
          onMouseEnter={enter}
          onMouseLeave={leave}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: W,
            transform: pos.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
          }}
          className={cn(
            "rounded-md border border-cyan-dim bg-[#06080a] px-2.5 py-2 text-[10.5px] leading-snug text-txt text-left z-[60] shadow-xl normal-case tracking-normal font-sans",
            show ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none",
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
        </span>,
        document.body,
      )}
    </>
  );
}
