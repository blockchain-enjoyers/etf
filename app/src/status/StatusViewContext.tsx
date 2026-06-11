import { createContext, useContext, useMemo, useState } from "react";

export interface StatusViewValue {
  view: string | null;
  setView: (view: string | null) => void;
}

// Default value lets StatusBar render in isolation (no provider) without crashing.
const NOOP: StatusViewValue = { view: null, setView: () => {} };

const StatusViewContext = createContext<StatusViewValue>(NOOP);

export function StatusViewProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<string | null>(null);
  const value = useMemo(() => ({ view, setView }), [view]);
  return <StatusViewContext.Provider value={value}>{children}</StatusViewContext.Provider>;
}

export function useStatusView(): StatusViewValue {
  return useContext(StatusViewContext);
}
