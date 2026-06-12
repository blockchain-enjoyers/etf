import { useState, useRef, useLayoutEffect, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

const W = 224; // tooltip width (px), matches w-56

export function HelpTip({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, below: false });
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enter = () => {
    if (timer.current) clearTimeout(timer.current);
    setHover(true);
  };
  const leave = () => {
    timer.current = setTimeout(() => setHover(false), 120);
  };

  const place = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 200;
    const cx = r.left + r.width / 2;
    const left = Math.min(Math.max(cx, W / 2 + 8), window.innerWidth - W / 2 - 8);
    setPos({ top: below ? r.bottom + 8 : r.top - 8, left, below });
  };

  useLayoutEffect(() => {
    if (hover) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover]);

  useEffect(() => {
    if (!hover) return;
    const reposition = () => place();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover]);

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        aria-label="Help"
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        className="inline-grid place-items-center w-3.5 h-3.5 rounded-full border border-line text-txt3 text-[9px] font-mono cursor-help hover:border-cyan hover:text-cyan align-middle"
      >
        ?
      </span>
      {createPortal(
        <span
          role="tooltip"
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
            hover ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none",
          )}
        >
          {children}
        </span>,
        document.body,
      )}
    </>
  );
}
