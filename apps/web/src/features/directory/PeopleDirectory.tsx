import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { Search, Users } from 'lucide-react';
import type { UserSummary } from '@chat/contracts';
import { Avatar, EmptyState, ErrorState, Input, cn } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { groupByLetter, type DirectoryRow } from './groupByLetter';
import { InviteButton } from './InviteButton';
import { useDirectory } from './useDirectory';

const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 60;

export interface PeopleDirectoryProps {
  /** Called with the person whose button (or Enter) was used. */
  onPick: (user: UserSummary) => void;
  /** Screen-reader name of the row button, e.g. "Chat with Bob". */
  actionLabel: (user: UserSummary) => string;
  /** Visible text of the row button: "Message" or "Add". */
  buttonText?: string;
  /** People who cannot be picked (already in the chat or group). */
  disabledIds?: readonly string[];
  disabledLabel?: string;
  /** Size of the scrolling list, e.g. "h-72" in a dialog or "min-h-0 flex-1" on a page. */
  listClassName?: string;
  autoFocus?: boolean;
}

const countText = (n: number, hasMore: boolean, searching: boolean): string => {
  if (searching) return n === 1 ? '1 result' : `${n} results`;
  if (hasMore) return `${n}+ people on Flick`;
  return n === 1 ? '1 person on Flick' : `${n} people on Flick`;
};

const SkeletonRows = () => (
  <div role="status" aria-label="Loading people" className="space-y-1 p-2">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className="flex h-[52px] animate-pulse items-center gap-3">
        <div className="size-8 rounded-full bg-base-content/10" />
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-base-content/10" />
          <div className="h-2.5 w-20 rounded bg-base-content/10" />
        </div>
      </div>
    ))}
  </div>
);

/**
 * Everyone on Flick, A to Z, with a search box. Only the rows on screen are in the page, so 5,000
 * people cost the same as 20. Used by "New chat", "Add members" and the People page.
 */
export const PeopleDirectory = ({
  onPick,
  actionLabel,
  buttonText = 'Message',
  disabledIds = [],
  disabledLabel = 'Already added',
  listClassName = 'h-72',
  autoFocus = false,
}: PeopleDirectoryProps) => {
  const myId = useSessionStore((s) => s.user?.id);
  const [text, setText] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const { items, hasMore, loading, loadingMore, error, searching, loadMore, retry } =
    useDirectory(text);

  const disabled = useMemo(() => new Set(disabledIds), [disabledIds]);
  const people = useMemo(() => items.filter((u) => u.id !== myId), [items, myId]);
  // A to Z with letter headers; search results stay in the order the server ranked them.
  const rows = useMemo<DirectoryRow[]>(
    () => (searching ? people.map((user) => ({ kind: 'user', user })) : groupByLetter(people)),
    [people, searching],
  );
  const headerIndexes = useMemo(
    () => rows.flatMap((r, i) => (r.kind === 'header' ? [i] : [])),
    [rows],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyIndex = useRef(-1);
  // The header of the letter you are in stays at the top, even when its own row scrolled away.
  const rangeExtractor = useCallback(
    (range: Range) => {
      stickyIndex.current = [...headerIndexes].reverse().find((i) => range.startIndex >= i) ?? -1;
      const wanted = new Set([stickyIndex.current, ...defaultRangeExtractor(range)]);
      return [...wanted].filter((i) => i >= 0).sort((a, b) => a - b);
    },
    [headerIndexes],
  );
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 6,
    rangeExtractor,
  });

  // Load the next page when the end of the list scrolls into view (the button is the fallback).
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const end = endRef.current;
    if (!end || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root: scrollRef.current },
    );
    observer.observe(end);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadMore, rows.length]);

  // Arrow keys move through the people who can be picked; Enter in the search box picks one.
  const pickable = useMemo(() => people.filter((u) => !disabled.has(u.id)), [people, disabled]);
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (pickable.length === 0) return;
      const at = pickable.findIndex((u) => u.id === activeId);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = pickable[Math.min(pickable.length - 1, Math.max(0, at + step))];
      if (!next) return;
      setActiveId(next.id);
      const rowIndex = rows.findIndex((r) => r.kind === 'user' && r.user.id === next.id);
      virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      const active = pickable.find((u) => u.id === activeId);
      if (active) {
        e.preventDefault();
        onPick(active);
      }
    }
  };

  const jumpTo = (letter: string): void => {
    const at = rows.findIndex((r) => r.kind === 'header' && r.letter === letter);
    if (at >= 0) virtualizer.scrollToIndex(at, { align: 'start' });
  };

  const showList = !loading && !error && rows.length > 0;
  const activeRow = (id: string): string => `person-${id}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-base-content/60" aria-live="polite">
          {loading || error ? ' ' : countText(people.length, hasMore, searching)}
        </p>
        <InviteButton />
      </div>
      <Input
        type="search"
        label="Search people"
        placeholder="Search by name or username"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActiveId(null);
        }}
        leadingIcon={<Search className="size-4" />}
        autoFocus={autoFocus}
        aria-controls="people-list"
        aria-activedescendant={activeId ? activeRow(activeId) : undefined}
      />

      <div className={cn('relative min-h-0', listClassName)}>
        {/* On phones the list leaves a gutter on the right for the letter strip, so the strip never
            sits on top of the Add / Message buttons. */}
        <div
          ref={scrollRef}
          className={cn(
            'scroll-slim h-full overflow-y-auto',
            showList && !searching && headerIndexes.length > 1 && 'max-sm:pr-7',
          )}
        >
          {loading && <SkeletonRows />}
          {error && <ErrorState title="Couldn't load people" message={error} onRetry={retry} />}
          {!loading && !error && rows.length === 0 && (
            <>
              <EmptyState
                icon={<Users className="size-8" />}
                title={searching ? 'No one found' : 'No one else is here yet'}
                description={searching ? undefined : 'Invite a friend'}
              />
            </>
          )}
          {showList && (
            <div
              id="people-list"
              role="list"
              aria-label="People"
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                const sticky = item.index === stickyIndex.current;
                const style = sticky
                  ? { position: 'sticky' as const, top: 0, zIndex: 1, height: item.size }
                  : {
                      position: 'absolute' as const,
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: item.size,
                      transform: `translateY(${item.start}px)`,
                    };
                if (row.kind === 'header') {
                  return (
                    <div
                      key={`h-${row.letter}`}
                      role="presentation"
                      data-letter-header={row.letter}
                      style={style}
                      className="flex items-center rounded-lg bg-base-200 px-3 text-xs font-bold uppercase tracking-wide text-primary"
                    >
                      {row.letter}
                    </div>
                  );
                }
                const { user } = row;
                const off = disabled.has(user.id);
                return (
                  <div
                    key={user.id}
                    id={activeRow(user.id)}
                    role="listitem"
                    aria-current={user.id === activeId ? 'true' : undefined}
                    aria-disabled={off || undefined}
                    style={style}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-2',
                      user.id === activeId && 'bg-primary/10',
                      off && 'opacity-60',
                    )}
                  >
                    <Avatar src={user.avatar_url} name="" size="xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{user.display_name}</span>
                      <span className="block truncate text-xs text-base-content/60">
                        @{user.username}
                      </span>
                    </span>
                    {off ? (
                      <span className="text-xs text-base-content/60">{disabledLabel}</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-outline btn-xs rounded-full"
                        aria-label={actionLabel(user)}
                        onClick={() => {
                          onPick(user);
                        }}
                      >
                        {buttonText}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div ref={endRef} className="flex justify-center py-2">
            {hasMore && !error && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            )}
          </div>
        </div>

        {/* Phones: tap a letter to jump there. */}
        {showList && !searching && headerIndexes.length > 1 && (
          <div
            className="absolute inset-y-1 right-0 flex w-6 flex-col items-center justify-start gap-0.5 overflow-y-auto rounded-full bg-base-200/80 py-1 sm:hidden"
            role="group"
            aria-label="Jump to letter"
          >
            {headerIndexes.map((i) => {
              const row = rows[i];
              const letter = row?.kind === 'header' ? row.letter : '';
              return (
                <button
                  key={letter}
                  type="button"
                  className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-primary active:bg-primary/20"
                  aria-label={`Jump to ${letter}`}
                  onClick={() => {
                    jumpTo(letter);
                  }}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
