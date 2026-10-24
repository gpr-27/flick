import { useCallback, useEffect, useRef, useState } from 'react';
import { ENDPOINTS, type UserSummary } from '@chat/contracts';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 250;

interface State {
  q: string; // the search text these results belong to ('' = the A-Z directory)
  items: UserSummary[];
  next: string | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}

const empty = (q: string): State => ({ q, items: [], next: null, status: 'loading', error: null });

const useDebounced = (value: string): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [value]);
  return debounced;
};

/**
 * Everyone on Flick, A to Z, a page at a time. With search text it shows the server's search
 * results instead. A page that was asked for is never asked for again (until it fails and you retry).
 */
export const useDirectory = (text: string) => {
  const q = useDebounced(text.trim());
  const [state, setState] = useState<State>(() => empty(q));
  const asked = useRef({ q, cursors: new Set<string>() });

  const fetchPage = useCallback(async (search: string, cursor: string | null) => {
    if (asked.current.q !== search) asked.current = { q: search, cursors: new Set() };
    const key = cursor ?? '';
    if (asked.current.cursors.has(key)) return;
    asked.current.cursors.add(key);
    setState((s) => (s.q === search ? { ...s, status: 'loading', error: null } : empty(search)));
    try {
      const api = getApi();
      const page = search
        ? await api.call(ENDPOINTS.users.search, { query: { q: search } })
        : await api.call(ENDPOINTS.users.directory, {
            query: { cursor: cursor ?? undefined, limit: PAGE_SIZE },
          });
      const { items, next_cursor } = page;
      setState((s) => {
        if (s.q !== search) return s; // the person typed something else meanwhile
        const seen = new Set(s.items.map((u) => u.id));
        const fresh = items.filter((u) => !seen.has(u.id));
        return {
          ...s,
          items: [...s.items, ...fresh],
          next: search ? null : (next_cursor ?? null),
          status: 'ready',
        };
      });
    } catch (error) {
      asked.current.cursors.delete(key); // so Retry can ask again
      setState((s) =>
        s.q === search
          ? { ...s, status: 'error', error: getErrorMessage(error, "Couldn't load people.") }
          : s,
      );
    }
  }, []);

  useEffect(() => {
    void fetchPage(q, null);
  }, [q, fetchPage]);

  const loadMore = useCallback(() => {
    if (state.status === 'ready' && state.next) void fetchPage(state.q, state.next);
  }, [state.status, state.next, state.q, fetchPage]);

  const retry = useCallback(() => {
    void fetchPage(state.q, state.items.length > 0 ? state.next : null);
  }, [state.q, state.items.length, state.next, fetchPage]);

  // Between typing and the debounce, the old results are not the answer yet.
  const waiting = text.trim() !== q || state.q !== q;
  return {
    items: state.q === q ? state.items : [],
    hasMore: state.next !== null,
    // First page only: while a later page loads we keep showing the list.
    loading: waiting || (state.status === 'loading' && state.items.length === 0),
    loadingMore: state.status === 'loading' && state.items.length > 0,
    error: waiting ? null : state.status === 'error' ? state.error : null,
    searching: text.trim() !== '',
    loadMore,
    retry,
  };
};
