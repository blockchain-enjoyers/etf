import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: "ok" | "info";
}

interface ToastApi {
  push: (t: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Push transient toasts. Safe outside the provider (no-op) so non-app renders don't throw. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { push: () => {} };
}

const AUTO_DISMISS_MS = 7000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((cur) => [...cur, { ...t, id }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "flex items-start gap-2.5 rounded-lg border bg-bg2 px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
              t.tone === "ok" ? "border-emerald/40" : "border-cyan-dim",
            )}
          >
            <span className={cn("mt-px shrink-0", t.tone === "ok" ? "text-emerald" : "text-cyan")}>
              {t.tone === "ok" ? "✓" : "ⓘ"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-txt">{t.title}</div>
              {t.body && <div className="text-[11px] text-txt2 mt-0.5 leading-relaxed">{t.body}</div>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 px-1 font-mono text-sm text-txt3 hover:text-txt"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
