// Virtualised, bottom-anchored message list.
//
// Scroll contract (covered by VirtualMessageList.test.tsx):
//  - Opens at the newest message.
//  - Prepending older pages keeps the message under the reader exactly where
//    it was (anchorTo: "end" re-anchors on the first visible row).
//  - New messages stick to the bottom ONLY when the reader is already at the
//    bottom (followOnAppend); otherwise a "Jump to latest" button appears.
//  - Scrolling near the top asks for the previous page.
import { useVirtualizer, type Rect, type VirtualItem } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Spinner } from '@/components/ui';

/** Within this many px of the bottom counts as "at the bottom". */
export const STICK_THRESHOLD_PX = 48;
/** Start loading the previous page when this close to the top. */
export const LOAD_OLDER_THRESHOLD_PX = 240;
const FOOTER_KEY = '__footer__';

export interface VirtualMessageListHandle {
  scrollToKey: (key: string) => boolean;
  scrollToBottom: () => void;
}

export interface VirtualMessageListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize?: (item: T) => number;
  /** Trailing row (e.g. the typing indicator); part of the stick-to-bottom flow. */
  footer?: ReactNode;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  label: string;
  /** Day label for an item; the current one floats at the top while scrolling. */
  dateLabel?: (item: T) => string;
  className?: string;
  /** Test hook: initial viewport size before ResizeObserver reports one. */
  initialRect?: Rect;
}

const defaultEstimate = (): number => 72;

function VirtualMessageListInner<T>(
  {
    items,
    getKey,
    renderItem,
    estimateSize = defaultEstimate,
    footer,
    hasOlder,
    isLoadingOlder,
    onLoadOlder,
    label,
    dateLabel,
    className,
    initialRect,
  }: VirtualMessageListProps<T>,
  ref: React.ForwardedRef<VirtualMessageListHandle>,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasFooter = footer !== undefined && footer !== null && footer !== false;
  const count = items.length + (hasFooter ? 1 : 0);
  const [atBottom, setAtBottom] = useState(true);
  // Messages that arrived while the reader was scrolled up (shown on the jump button).
  const [newCount, setNewCount] = useState(0);
  const [floatingDate, setFloatingDate] = useState<string | null>(null);
  const hideDate = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastKey = useRef<string | undefined>(undefined);

  const keyAt = useCallback(
    (index: number): string => {
      const item = items[index];
      return item === undefined ? FOOTER_KEY : getKey(item);
    },
    [items, getKey],
  );

  // The virtualizer returns fresh functions each render by design; this
  // component does not rely on React Compiler memoisation.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = items[index];
      return item === undefined ? 40 : estimateSize(item);
    },
    getItemKey: keyAt,
    overscan: 8,
    paddingStart: 16,
    paddingEnd: 16,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: STICK_THRESHOLD_PX,
    ...(initialRect ? { initialRect } : {}),
  });

  // Open at the newest message (once, when the first rows arrive).
  const didInitialScroll = useRef(false);
  useLayoutEffect(() => {
    if (didInitialScroll.current || count === 0) return;
    didInitialScroll.current = true;
    virtualizer.scrollToEnd();
  }, [count, virtualizer]);

  const loadOlderIfNeeded = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasOlder || isLoadingOlder || !didInitialScroll.current) return;
    const nearTop = el.scrollTop <= LOAD_OLDER_THRESHOLD_PX;
    const underfilled = el.scrollHeight <= el.clientHeight;
    if (nearTop || underfilled) onLoadOlder();
  }, [hasOlder, isLoadingOlder, onLoadOlder]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD_PX;
    setAtBottom(bottom);
    if (bottom) setNewCount(0);
    loadOlderIfNeeded();
    if (dateLabel) {
      const first = virtualizer.getVirtualItems().find((v) => v.end > el.scrollTop);
      const item = first ? items[first.index] : undefined;
      setFloatingDate(item === undefined ? null : dateLabel(item));
      clearTimeout(hideDate.current);
      hideDate.current = setTimeout(() => {
        setFloatingDate(null);
      }, 1500);
    }
  }, [loadOlderIfNeeded, dateLabel, virtualizer, items]);

  useEffect(
    () => () => {
      clearTimeout(hideDate.current);
    },
    [],
  );

  // Count rows that were appended while the reader is away from the bottom.
  useEffect(() => {
    const newest = items[items.length - 1];
    const key = newest === undefined ? undefined : getKey(newest);
    const previous = lastKey.current;
    lastKey.current = key;
    if (previous === undefined || key === previous || atBottom) return;
    // Appended (the old newest is still in the list), not a prepended page.
    if (items.some((item) => getKey(item) === previous)) {
      const from = items.findIndex((item) => getKey(item) === previous);
      setNewCount((n) => n + (items.length - 1 - from));
    }
  }, [items, getKey, atBottom]);

  // A short first page may not fill the viewport: keep loading until it does.
  useEffect(() => {
    loadOlderIfNeeded();
  }, [items.length, loadOlderIfNeeded]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToKey: (key) => {
        const index = items.findIndex((item) => getKey(item) === key);
        if (index < 0) return false;
        // Not 'smooth': a long smooth scroll over rows whose heights are still estimates stops short
        // of the target (the rows it passes get measured and move it), so the message was not
        // reached. An instant jump is re-aimed after every measurement and lands on it.
        virtualizer.scrollToIndex(index, { align: 'center' });
        return true;
      },
      scrollToBottom: () => {
        virtualizer.scrollToEnd({ behavior: 'smooth' });
      },
    }),
    [items, getKey, virtualizer],
  );

  const renderRow = (row: VirtualItem) => {
    const item = items[row.index];
    return (
      <div
        key={row.key.toString()}
        data-index={row.index}
        ref={virtualizer.measureElement}
        // `top` rather than a transform: transformed ancestors would trap the
        // `position: fixed` click-catchers used by the reaction picker.
        style={{ position: 'absolute', top: row.start, left: 0, width: '100%' }}
        className="px-3 sm:px-6"
      >
        {item === undefined ? footer : renderItem(item, row.index)}
      </div>
    );
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label={label}
        // Rows mount and unmount while scrolling; announcements come from a
        // dedicated live region instead (see ChatContainer).
        aria-live="off"
        aria-busy={isLoadingOlder || undefined}
        tabIndex={0}
        data-testid="message-scroller"
        className={`scroll-slim h-full overflow-y-auto [overflow-anchor:none] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${className ?? ''}`}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map(renderRow)}
        </div>
      </div>

      {isLoadingOlder && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="chip gap-2 text-xs">
            <Spinner size="xs" label={null} />
            Loading earlier messages…
          </span>
        </div>
      )}

      {floatingDate && !isLoadingOlder && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="chip text-[11px] font-semibold" data-testid="floating-date">
            {floatingDate}
          </span>
        </div>
      )}

      {!atBottom && (
        <button
          type="button"
          onClick={() => {
            virtualizer.scrollToEnd({ behavior: 'smooth' });
          }}
          className="glass-card absolute bottom-3 right-4 grid size-10 place-items-center rounded-full text-primary shadow-lg transition-transform hover:scale-105"
          aria-label="Jump to latest message"
          title="Jump to latest"
        >
          <ArrowDown className="size-5" aria-hidden="true" />
          {newCount > 0 && (
            <span
              className="absolute -right-1 -top-2 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-content"
              data-testid="new-count"
            >
              {newCount > 99 ? '99+' : newCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

export const VirtualMessageList = forwardRef(VirtualMessageListInner) as <T>(
  props: VirtualMessageListProps<T> & { ref?: React.Ref<VirtualMessageListHandle> },
) => ReturnType<typeof VirtualMessageListInner>;
