import type { ReactNode } from "react";

export function HelpTip({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-grid place-items-center w-3.5 h-3.5 rounded-full border border-line text-txt3 text-[9px] font-mono cursor-help hover:border-cyan hover:text-cyan align-middle">
      ?
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[130%] left-1/2 -translate-x-1/2 w-56 rounded-md border border-cyan-dim bg-[#06080a] px-2.5 py-2 text-[10.5px] leading-snug text-txt text-left opacity-0 invisible transition group-hover:opacity-100 group-hover:visible z-40 shadow-xl normal-case tracking-normal font-sans"
      >
        {children}
      </span>
    </span>
  );
}
