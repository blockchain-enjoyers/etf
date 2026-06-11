import type { TxPlan } from "./dto.js";

export interface TxPlanSafetyContext {
  addressBook: Record<string, string>;
  constituentTokens: string[];
}

export function assertTxPlanSafe(plan: TxPlan, ctx: TxPlanSafetyContext): void {
  const allowed = new Set<string>([
    ...Object.values(ctx.addressBook).map((a) => a.toLowerCase()),
    ...ctx.constituentTokens.map((a) => a.toLowerCase()),
  ]);
  for (const step of plan.steps) {
    if (step.kind === "sign712") continue;
    if (!allowed.has(step.to.toLowerCase())) {
      throw new Error(`TxPlan rejected: unknown destination ${step.to} for step "${step.label}"`);
    }
  }
}
