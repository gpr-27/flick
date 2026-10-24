import { cn } from '@/components/ui';

const ROWS = Array.from({ length: 6 }, (_, i) => i);

export const MessageSkeleton = () => (
  <div
    className="scroll-slim relative flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-6"
    aria-busy="true"
  >
    <span className="sr-only" role="status">
      Loading messages…
    </span>
    {ROWS.map((idx) => {
      const isMine = idx % 2 === 1;
      return (
        <div
          key={idx}
          className={cn('flex items-end gap-2', isMine ? 'flex-row-reverse' : 'flex-row')}
          aria-hidden="true"
        >
          {!isMine && (
            <div className="skeleton size-8 shrink-0 rounded-full ring-2 ring-primary/10" />
          )}
          <div className={cn('flex flex-col gap-1', isMine ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'skeleton h-14 rounded-2xl',
                isMine ? 'rounded-br-md' : 'rounded-bl-md',
                idx % 3 === 0 ? 'w-52' : 'w-40',
              )}
            />
            <div className={cn('skeleton h-2.5 w-12 rounded-full', isMine && 'self-end')} />
          </div>
        </div>
      );
    })}
  </div>
);

export default MessageSkeleton;
