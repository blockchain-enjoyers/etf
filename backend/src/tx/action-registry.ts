export interface BuiltStep {
  kind: "approve" | "call";
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  contractName: string;
  label: string;
  summary: string;
  needsPriorApproval?: boolean;
}

export interface SignStep {
  kind: "sign712";
  token: string;
  typedData: unknown;
  label: string;
  summary: string;
}

export type PlanStep = BuiltStep | SignStep;

export interface ActionResult {
  steps: PlanStep[];
  finalize?: { path: string } | null;
}
