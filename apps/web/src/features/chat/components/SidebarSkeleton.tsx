const ROWS = Array.from({ length: 8 }, (_, i) => i);

export const SidebarSkeleton = () => (
  <aside
    className="flex h-full w-full flex-col border-r border-base-content/10 bg-base-100"
    aria-label="Conversations"
    aria-busy="true"
  >
    <span className="sr-only" role="status">
      Loading conversations…
    </span>
    <div className="space-y-3 px-4 pb-2 pt-3" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="skeleton h-6 w-28 rounded-lg" />
        <div className="skeleton h-6 w-20 rounded-full" />
      </div>
      <div className="skeleton h-10 w-full rounded-xl" />
    </div>

    <div className="flex-1 overflow-hidden" aria-hidden="true">
      {ROWS.map((idx) => (
        <div key={idx} className="flex w-full items-center min-h-[72px] gap-3 px-4 py-2.5">
          <div className="skeleton size-[52px] shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3.5 w-2/5 rounded-md" />
            <div className="skeleton h-3 w-3/5 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  </aside>
);

export default SidebarSkeleton;
