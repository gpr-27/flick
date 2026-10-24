import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { ENDPOINTS, type UserSummary } from '@chat/contracts';
import { Avatar, Input, Spinner } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

const DEBOUNCE_MS = 250;

/** Search box + results. `onPick` is called with the chosen user; `excludeIds` hides some. */
export const UserSearch = ({
  onPick,
  excludeIds = [],
  actionLabel,
}: {
  onPick: (user: UserSummary) => void;
  excludeIds?: readonly string[];
  actionLabel: (user: UserSummary) => string;
}) => {
  const myId = useSessionStore((s) => s.user?.id);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<{
    q: string;
    results: UserSummary[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let alive = true;
    const timer = setTimeout(() => {
      getApi()
        .call(ENDPOINTS.users.search, { query: { q } })
        .then((res) => {
          if (alive) setState({ q, results: res.items, error: null });
        })
        .catch((error: unknown) => {
          if (alive) setState({ q, results: [], error: getErrorMessage(error, 'Search failed.') });
        });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const q = query.trim();
  const loading = q !== '' && state?.q !== q;
  const results = (state?.q === q ? state.results : []).filter(
    (u) => u.id !== myId && !excludeIds.includes(u.id),
  );

  return (
    <div className="space-y-3">
      <Input
        type="search"
        label="Search people"
        placeholder="Search by name or username"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        leadingIcon={<Search className="size-4" />}
        autoFocus
      />
      <div className="scroll-slim max-h-64 overflow-y-auto" aria-live="polite">
        {loading && <Spinner size="sm" label="Searching" />}
        {state?.error && q !== '' && <p className="text-sm text-error">{state.error}</p>}
        {!loading && q !== '' && !state?.error && results.length === 0 && (
          <p className="py-2 text-sm text-base-content/60">No one found.</p>
        )}
        <ul>
          {results.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(user);
                }}
                aria-label={actionLabel(user)}
                className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-base-content/5"
              >
                <Avatar src={user.avatar_url} name="" size="xs" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{user.display_name}</span>
                  <span className="block truncate text-xs text-base-content/60">
                    @{user.username}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
