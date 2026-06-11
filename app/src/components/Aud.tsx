import { cn } from "../lib/cn";

export type Role = "holder" | "ap" | "keeper" | "curator";
const LABEL: Record<Role, string> = { holder: "Holder", ap: "AP", keeper: "Keeper", curator: "Curator" };
const PREFIXED: Record<Role, string> = {
  holder: "For: Holder / Investor",
  ap: "For: Authorized Participant",
  keeper: "For: Keeper / Forward Operator",
  curator: "For: Curator / Manager",
};
const STYLE: Record<Role, string> = {
  holder: "text-cyan bg-cyan/[0.12]",
  ap: "text-violet bg-violet/[0.14]",
  keeper: "text-amber bg-amber/[0.13]",
  curator: "text-emerald bg-emerald/[0.12]",
};

export function Aud({ role, prefixed = false, className }: { role: Role; prefixed?: boolean; className?: string }) {
  return (
    <span className={cn("font-mono text-[8.5px] tracking-wider uppercase px-1.5 py-0.5 rounded", STYLE[role], className)}>
      {prefixed ? PREFIXED[role] : LABEL[role]}
    </span>
  );
}
