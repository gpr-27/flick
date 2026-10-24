import { useEffect, useState } from 'react';
import { ENDPOINTS, type JoinRequest } from '@chat/contracts';
import type { z } from 'zod';
import { Avatar, Badge, ErrorState, Spinner, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

type Request = z.infer<typeof JoinRequest>;

/** Group info, admins only (the parent decides): people waiting to join, to approve or deny. */
export const JoinRequestsSection = ({ conversationId }: { conversationId: string }) => {
  const [items, setItems] = useState<Request[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.conversations.joinRequests, {
        params: { conversation_id: conversationId },
        query: {},
      })
      .then(
        (page) => {
          if (!cancelled) setItems(page.items);
        },
        (e: unknown) => {
          if (!cancelled) setError(getErrorMessage(e, "Couldn't load join requests."));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [conversationId, attempt]);

  const decide = async (request: Request, approve: boolean): Promise<void> => {
    setBusyId(request.id);
    try {
      await getApi().call(ENDPOINTS.conversations.decideJoinRequest, {
        params: { conversation_id: conversationId, request_id: request.id },
        body: { approve },
      });
      setItems((current) => current?.filter((r) => r.id !== request.id) ?? null);
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't save that decision."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mt-4" aria-labelledby="join-requests-title">
      <h3
        id="join-requests-title"
        className="mb-2 flex items-center gap-2 text-sm font-semibold text-base-content/60"
      >
        Join requests
        {items && items.length > 0 && (
          <Badge variant="count" label={`${items.length} pending`}>
            {items.length}
          </Badge>
        )}
      </h3>
      {error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : !items ? (
        <Spinner size="sm" label="Loading join requests" />
      ) : items.length === 0 ? (
        <p className="text-sm text-base-content/60">No one is waiting to join.</p>
      ) : (
        <ul>
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl p-2">
              <Avatar src={r.user.avatar_url} name="" size="xs" />
              <span className="min-w-0 flex-1 truncate font-semibold">{r.user.display_name}</span>
              <button
                type="button"
                className="btn btn-primary btn-sm min-h-11 sm:min-h-8"
                disabled={busyId === r.id}
                aria-label={`Approve ${r.user.display_name}`}
                onClick={() => void decide(r, true)}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm min-h-11 text-error sm:min-h-8"
                disabled={busyId === r.id}
                aria-label={`Deny ${r.user.display_name}`}
                onClick={() => void decide(r, false)}
              >
                Deny
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
