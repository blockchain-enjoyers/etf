import { cn } from "../lib/cn";

type StepStatus = "complete" | "active" | "upcoming";

export interface Step {
  label: string;
  status: StepStatus;
}

interface StepperProps {
  steps: Step[];
  className?: string;
}

const statusClass: Record<StepStatus, string> = {
  complete: "bg-cyan text-[#06080a]",
  active: "border-2 border-cyan bg-surface text-cyan",
  upcoming: "border border-line bg-surface2 text-txt3",
};

export function Stepper({ steps, className }: StepperProps) {
  return (
    <nav aria-label="progress" className={cn("flex items-center gap-2", className)}>
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center gap-2">
          {i > 0 && (
            <div
              aria-hidden="true"
              className="h-px w-6 bg-line"
            />
          )}
          <div className="flex flex-col items-center gap-0.5">
            <div
              aria-current={step.status === "active" ? "step" : undefined}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                statusClass[step.status]
              )}
            >
              {step.status === "complete" ? "✓" : i + 1}
            </div>
            <span className="text-[10px] text-txt2">{step.label}</span>
          </div>
        </div>
      ))}
    </nav>
  );
}
