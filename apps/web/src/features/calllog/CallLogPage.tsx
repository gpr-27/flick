import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Users, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ENDPOINTS } from '@chat/contracts';
import { Button, EmptyState, ErrorState, Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { CallNotificationCard } from '@/features/calls/components/CallNotificationCard';
import { useCallStore } from '@/features/calls/useCallStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { useFeatureGuide } from '@/features/guide/useFeatureGuide';
import { conversationTitle } from '@/features/chat/conversationView';
import type { CallLogEntry } from '../groupcall/types';
import { VoiceComposer } from '@/features/content/voice/VoiceComposer';
import { sendMessage } from '@/features/chat/outbox/useOutboxStore';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useMissedCalls } from './useMissedCalls';
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
  const myId = useSessionStore((s) => s.user?.id);
  const Icon =
    entry.outcome === 'missed'
      ? PhoneMissed
      : entry.direction === 'incoming'
        ? PhoneIncoming
        : PhoneOutgoing;
  const name = conversation ? conversationTitle(conversation) : 'Unknown chat';

  return (
    <li className="relative flex min-h-[68px] items-center gap-3 border-b border-base-content/5 px-4 py-2.5 last:border-b-0 hover:bg-[var(--bg-hover)]">
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-full ${entry.outcome === 'missed' ? 'bg-error/10 text-error' : 'bg-[var(--bg-active)] text-primary-text'}`}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-base font-semibold ${entry.outcome === 'missed' ? 'text-error' : ''}`}
        >
          {name}
        </p>
        <p className="truncate text-sm text-[var(--text-2)]">
          {label(entry)} · {formatCallWhen(entry.started_at)}
          {entry.outcome === 'ended' && ` · ${formatCallDuration(entry.duration_s)}`}
        </p>
      </div>
      {entry.outcome === 'missed' && entry.direction === 'outgoing' && target && myId && (
        // A missed call you made: record a voice note that arrives flagged as a voicemail.
        <VoiceComposer
          voicemail
          disabled={busy}
          buttonClassName="size-10 min-h-[44px] min-w-[44px] text-primary-text"
          onSend={(content) => {
            sendMessage(myId, target.conversation.id, content);
          }}
        />
      )}
      {entry.group && <Users className="size-4 text-[var(--text-2)]" aria-label="Group call" />}
      {target && (
        <button
          type="button"
          disabled={busy}
          className="btn btn-circle btn-ghost size-10 min-h-[44px] min-w-[44px] text-primary-text disabled:opacity-40"
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
  const navigate = useNavigate();
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
        action={{
          label: 'Find people',
          onClick: () => {
            navigate('/people');
          },
        }}
      />
    );
  } else {
    body = (
      <>
        <ul
          aria-label="Recent calls"
          className="overflow-hidden rounded-2xl border border-base-content/10 bg-base-100"
        >
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

  useEffect(() => {
    useMissedCalls.getState().markSeen();
  }, []);

  useFeatureGuide('calls.tab');
  return (
    <main className="app-bg min-h-dvh-screen px-4 pb-24 pt-[calc(4.5rem+env(safe-area-inset-top))] sm:pb-12 sm:pt-[calc(5rem+env(safe-area-inset-top))]">
      <div data-guide="calls.list" className="mx-auto max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[22px] font-bold">Calls</h1>
          <Link to="/" className="btn btn-ghost btn-sm">
            Chats
          </Link>
        </div>
        <CallNotificationCard className="mb-3" />
        {body}
      </div>
    </main>
  );
};

export default CallLogPage;
