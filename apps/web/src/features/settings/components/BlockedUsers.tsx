import { useEffect, useState } from 'react';
import { ENDPOINTS, type BlockList } from '@chat/contracts';
import type { z } from 'zod';
import { Avatar } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { ReportDialog, type ReportTarget } from './ReportDialog';

type Blocked = z.infer<typeof BlockList>['items'][number];

export const BlockedUsers = () => {
  const [items, setItems] = useState<Blocked[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [attempt, setAttempt] = useState(0);

  const fetchPage = (after?: string) =>
    getApi().call(ENDPOINTS.moderation.blocks, { query: after ? { cursor: after } : {} });

  useEffect(() => {
    let cancelled = false;
    fetchPage().then(
      (page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.next_cursor);
      },
      (e: unknown) => {
        if (!cancelled) setError(getErrorMessage(e, "Couldn't load blocked users."));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = (): void => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  const showMore = async (after: string): Promise<void> => {
    try {
      const page = await fetchPage(after);
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.next_cursor);
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't load more."));
    }
  };

  const unblock = async (userId: string): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.moderation.unblock, { params: { user_id: userId } });
      setItems((current) => current?.filter((b) => b.user.id !== userId) ?? null);
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't unblock that user."));
    }
  };

  return (
    <section className="glass-card rounded-3xl p-6" aria-labelledby="blocked-title">
      <h2 id="blocked-title" className="font-display text-lg font-bold">
        Blocked users
      </h2>
      {error && (
        <div role="alert" className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-error">{error}</p>
          {!items && (
            <button type="button" className="btn btn-outline btn-sm" onClick={retry}>
              Retry
            </button>
          )}
        </div>
      )}
      {!items && !error && (
        <div className="mt-3 space-y-3" role="status" aria-busy="true">
          <span className="sr-only">Loading blocked users</span>
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-12 w-full rounded-xl" aria-hidden="true" />
          ))}
        </div>
      )}
      {items?.length === 0 && (
        <p className="mt-3 text-sm text-base-content/60">You have not blocked anyone.</p>
      )}
      <ul className="mt-3 space-y-3">
        {items?.map(({ user }) => (
          <li key={user.id} className="flex items-center gap-3">
            <Avatar src={user.avatar_url} name={user.display_name} size="md" />
            <span className="min-w-0 flex-1 truncate font-semibold">{user.display_name}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setReporting({ user_id: user.id });
              }}
            >
              Report
            </button>
            <button
              type="button"
              className="btn btn-outline btn-xs"
              aria-label={`Unblock ${user.display_name}`}
              onClick={() => void unblock(user.id)}
            >
              Unblock
            </button>
          </li>
        ))}
      </ul>
      {cursor && (
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-3"
          onClick={() => void showMore(cursor)}
        >
          Show more
        </button>
      )}
      <ReportDialog
        target={reporting}
        onClose={() => {
          setReporting(null);
        }}
      />
    </section>
  );
};
