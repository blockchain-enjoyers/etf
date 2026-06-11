import { Outlet } from "react-router-dom";
import { TerminalHeader } from "./TerminalHeader";
import { StatusBar } from "../components/StatusBar";
import { useFeed } from "../data/useFeed";
import { StatusViewProvider } from "../status/StatusViewContext";

export function AppShell() {
  const { data: feed } = useFeed();
  const marketStatus = feed?.items[0]?.marketStatus ?? null;
  return (
    <StatusViewProvider>
      <div className="flex flex-col h-screen overflow-hidden terminal-bg text-txt">
        <TerminalHeader />
        <main className="flex flex-col flex-1 min-w-0 overflow-y-auto pb-[34px]">
          <Outlet />
        </main>
        <StatusBar marketStatus={marketStatus} />
      </div>
    </StatusViewProvider>
  );
}
