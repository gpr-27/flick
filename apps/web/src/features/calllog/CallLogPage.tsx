import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Users, Video } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { Button, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useCallStore } from '@/features/calls/useCallStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { conversationTitle } from '@/features/chat/conversationView';
import type { CallLogEntry } from '../groupcall/types';
import { formatCallDuration, formatCallWhen } from './format';

type Status = 'loading' | 'ready' | 'error';
type CallLogPage = { items: CallLogEntry[]; next_cursor: string | null };

const fetchPage = (cursor?: string): Promise<CallLogPage> =>
  getApi().call(ENDPOINTS.calls.log, { query: { cursor, limit: 30 } });

/** The 1:1 call to ring back, or null (group calls and calls whose chat is gone). */
const callBackTarget = (entry: CallLogEntry) => {
  if (entry.group || !entry.conversation_id) return null;
  const conversation = useChatStore.getState().conversations[entry.conversation_id];
  return conversation?.peer ? { conversation, peer: conversation.peer } : null;
};

const label = (entry: CallLogEntry): string => {
  const kind = entry.group ? 'group' : entry.media === 'video' ? 'video' : 'voice';
  if (entry.outcome === 'missed') return `Missed ${kind} call`;
  if (entry.outcome === 'declined') return `Declined ${kind} call`;
  return `${entry.direction === 'incoming' ? 'Incoming' : 'Outgoing'} ${kind} call`;
};

const Row = ({ entry, busy }: { entry: CallLogEntry; busy: boolean }) => {
  const conversation = useChatStore((s) =>
    entry.conversation_id ? s.conversations[entry.conversation_id] : undefined,
  );
  const target = callBackTarget(entry);
  const Icon =
    entry.outcome === 'missed'
      ? PhoneMissed
      : entry.direction === 'incoming'
        ? PhoneIncoming
        : PhoneOutgoing;
  const name = conversation ? conversationTitle(conversation) : 'Unknown chat';

  return (
    <li className="flex items-center gap-3 rounded-2xl p-3 hover:bg-base-content/5">
      <Icon
        className={`size-5 shrink-0 ${entry.outcome === 'missed' ? 'text-error' : 'text-base-content/60'}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${entry.outcome === 'missed' ? 'text-error' : ''}`}>
          {name}
        </p>
        <p className="truncate text-sm text-base-content/60">
          {label(entry)} · {formatCallWhen(entry.started_at)}
          {entry.outcome === 'ended' && ` · ${formatCallDuration(entry.duration_s)}`}
        </p>
      </div>
      {entry.group && <Users className="size-4 text-base-content/50" aria-label="Group call" />}
      {target && (
        <button
          type="button"
          disabled={busy}
          className="btn btn-circle btn-ghost btn-sm text-primary disabled:opacity-40"
          aria-label={`Call ${name} back`}
          title="Call back"
          onClick={() =>
            void useCallStore
              .getState()
              .initiateCall(target.conversation.id, target.peer, entry.media)
          }
        >
          {entry.media === 'video' ? (
            <Video className="size-5" aria-hidden="true" />
          ) : (
            <Phone className="size-5" aria-hidden="true" />
          )}
        </button>
      )}
    </li>
  );
};

/** The Calls tab: recent calls, newest first, with call back for 1:1 calls. */
export const CallLogPage = () => {
  const [entries, setEntries] = useState<CallLogEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const inCall = useCallStore((s) => s.callStatus !== 'idle');

  const [attempt, setAttempt] = useState(0);

  const show = useCallback((page: CallLogPage, append: boolean): void => {
    setEntries((old) => (append ? [...old, ...page.items] : page.items));
    setNext(page.next_cursor);
    setStatus('ready');
  }, []);
  const showError = useCallback((e: unknown): void => {
    setError(getErrorMessage(e));
    setStatus('error');
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPage()
      .then((page) => {
        if (!cancelled) show(page, false);
      })
      .catch((e: unknown) => {
        if (!cancelled) showError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, show, showError]);

  let body;
  if (status === 'loading') {
    body = (
      <div className="flex justify-center py-16">
        <Spinner size="lg" label="Loading calls" />
      </div>
    );
  } else if (status === 'error') {
    body = (
      <ErrorState
        title="Couldn't load calls"
        message={error}
        onRetry={() => {
          setStatus('loading');
          setAttempt((n) => n + 1);
        }}
      />
    );
  } else if (entries.length === 0) {
    body = (
      <EmptyState
        icon={<Phone className="size-10" />}
        title="No calls yet"
        description="Calls you make and receive show up here."
      />
    );
  } else {
    body = (
      <>
        <ul aria-label="Recent calls">
          {entries.map((entry) => (
            <Row key={entry.call_id} entry={entry} busy={inCall} />
          ))}
        </ul>
        {next && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="dashed"
              loading={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                fetchPage(next)
                  .then((page) => {
                    show(page, true);
                  })
                  .catch(showError)
                  .finally(() => {
                    setLoadingMore(false);
                  });
              }}
            >
              Load more
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <main className="app-bg min-h-dvh-screen px-4 pb-8 pt-20">
      <div className="glass-card mx-auto max-w-xl rounded-3xl p-4 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-display text-xl font-bold">Calls</h1>
          <Link to="/" className="btn btn-ghost btn-sm">
            Chats
          </Link>
        </div>
        {body}
      </div>
    </main>
  );
};

export default CallLogPage;
