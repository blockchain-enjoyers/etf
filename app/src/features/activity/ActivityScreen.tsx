import { EmptyState } from "../../components/EmptyState";

function ActivityHeader() {
  return (
    <header className="flex items-center gap-3 border-b border-line bg-bg2 px-[18px] py-2.5 shrink-0">
      <h2 className="text-sm font-semibold tracking-wide text-txt">Activity</h2>
      <span className="font-mono text-[10px] uppercase tracking-widest text-txt3">
        fills · settlements · events
      </span>
    </header>
  );
}

export function ActivityScreen() {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ActivityHeader />
      <div className="p-[18px]">
        <EmptyState message="Activity feed coming soon" />
      </div>
    </div>
  );
}
