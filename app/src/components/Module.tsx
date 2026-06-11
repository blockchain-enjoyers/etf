import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Aud, type Role } from "./Aud";
import { HelpTip } from "./HelpTip";

export function Module({
  title, icon, audience, help, right, children, className, bodyClassName,
}: {
  title: ReactNode;
  icon?: ReactNode;
  audience?: Role;
  help?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("border border-line rounded-lg bg-surface overflow-hidden flex flex-col", className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-surface2">
        <div className="text-[11px] font-semibold tracking-wide flex items-center gap-1.5">
          {icon && <span className="flex items-center text-cyan">{icon}</span>}
          {title}
          {help && <HelpTip>{help}</HelpTip>}
        </div>
        <div className="flex-1" />
        {right}
        {audience && <Aud role={audience} />}
      </div>
      <div className={cn("p-3 flex-1", bodyClassName)}>{children}</div>
    </div>
  );
}
