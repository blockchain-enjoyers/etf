import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Aud, type Role } from "./Aud";

export type WorkspaceId = "trade" | "liquidity" | "operations" | "manage";
export interface WorkspaceTab {
  id: WorkspaceId;
  label: string;
  who: string;
  role: Role;
  icon?: ReactNode;
}
const ROLE_TEXT: Record<Role, string> = {
  holder: "text-cyan", ap: "text-violet", keeper: "text-amber", curator: "text-emerald",
};

export function WorkspaceTabs({ tabs, active, onChange }: { tabs: WorkspaceTab[]; active: WorkspaceId; onChange: (id: WorkspaceId) => void }) {
  return (
    <div role="tablist" className="flex border border-line rounded-lg overflow-hidden bg-surface">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cn(
              "flex-1 px-3.5 py-2.5 border-r border-line last:border-r-0 text-left transition-colors relative flex flex-col gap-0.5 items-start",
              on ? "bg-surface2" : "hover:bg-surface2",
            )}
          >
            <div className={cn("text-[13px] font-semibold flex items-center gap-1.5", on && ROLE_TEXT[t.role])}>
              {t.icon && <span aria-hidden>{t.icon}</span>}
              {t.label}
            </div>
            <div className="text-[10px] text-txt3">{t.who}</div>
            <Aud role={t.role} prefixed />
            {on && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-cyan shadow-[0_0_10px_var(--color-cyan)]" />}
          </button>
        );
      })}
    </div>
  );
}
