const ROWS = Array.from({ length: 8 }, (_, i) => i);

export const SidebarSkeleton = () => (
  <aside
    className="glass flex h-full w-full flex-col border-r border-base-content/10"
    aria-label="Conversations"
    aria-busy="true"
  >
    <span className="sr-only" role="status">
      Loading conversations…
    </span>
    <div className="space-y-3 border-b border-base-content/10 p-4" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="skeleton h-6 w-28 rounded-lg" />
        <div className="skeleton h-6 w-20 rounded-full" />
      </div>
      <div className="skeleton h-9 w-full rounded-xl" />
    </div>

    <div className="flex-1 space-y-1 overflow-hidden p-2" aria-hidden="true">
      {ROWS.map((idx) => (
        <div key={idx} className="flex w-full items-center gap-3 rounded-2xl p-2.5">
          <div className="skeleton size-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-4 w-28 rounded-md" />
            <div className="skeleton h-3 w-40 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  </aside>
);

export default SidebarSkeleton;
