import { cn } from "../lib/cn";

type ButtonVariant = "primary" | "default" | "disabled";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-cyan text-[#06080a] font-semibold border border-cyan hover:shadow-[0_0_18px_-4px_rgba(53,208,224,.45)]",
  default: "bg-surface2 border border-line text-txt hover:bg-surface3 hover:border-txt3",
  disabled: "bg-surface border border-line text-txt3 cursor-not-allowed opacity-40",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  full?: boolean;
  children: React.ReactNode;
}

export function Button({ variant = "default", full = false, children, className, disabled, ...rest }: ButtonProps) {
  const resolvedVariant: ButtonVariant = disabled ? "disabled" : variant;
  return (
    <button
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
        variantClass[resolvedVariant],
        full && "w-full",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
