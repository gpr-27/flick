import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { ENDPOINTS, type MessageContent } from '@chat/contracts';
import type { PollTally as PollTallySchema } from '@chat/contracts';
import { cn, notify } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { nextChoice } from './nextChoice';

type PollTally = z.infer<typeof PollTallySchema>;
type Poll = Extract<MessageContent, { type: 'poll' }>;

/** No vote event exists yet, so open polls re-read the tally now and then (see the report). */
const REFRESH_MS = 15_000;

export const PollView = ({
  poll,
  conversationId,
  messageId,
}: {
  poll: Poll;
  conversationId: string;
  messageId: string;
}) => {
  const myId = useSessionStore((s) => s.user?.id);
  const sent = !messageId.startsWith('local:'); // still in the outbox: nothing to vote on yet
  const [tally, setTally] = useState<PollTally | null>(null);
  const [busy, setBusy] = useState(false);

  const params = { conversation_id: conversationId, message_id: messageId };

  useEffect(() => {
    if (!sent) return;
    let alive = true;
    const load = (): void => {
      getApi()
        .call(ENDPOINTS.messages.getPoll, {
          params: { conversation_id: conversationId, message_id: messageId },
        })
        .then((next) => {
          if (alive) setTally(next);
        })
        .catch(() => undefined); // keep the last numbers; the next refresh may work
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [sent, conversationId, messageId]);

  const options =
    tally?.options ?? poll.options.map((text, index) => ({ index, text, voter_ids: [] }));
  const mine = options.filter((o) => myId && o.voter_ids.includes(myId)).map((o) => o.index);
  const voters = new Set(options.flatMap((o) => o.voter_ids)).size;

  const vote = async (index: number): Promise<void> => {
    if (!sent || busy) return;
    setBusy(true);
    try {
      setTally(
        await getApi().call(ENDPOINTS.messages.votePoll, {
          params,
          body: { option_indexes: nextChoice(mine, index, poll.allow_multiple) },
        }),
      );
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't save your vote."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-64">
      <p className="mb-1 font-semibold">{poll.question}</p>
      <p className="mb-2 text-xs opacity-70">
        {poll.allow_multiple ? 'Select one or more' : 'Select one'}
      </p>
      <ul className="space-y-1.5">
        {options.map((option) => {
          const count = option.voter_ids.length;
          const chosen = mine.includes(option.index);
          return (
            <li key={option.index}>
              <button
                type="button"
                onClick={() => void vote(option.index)}
                disabled={!sent || busy}
                aria-pressed={chosen}
                aria-label={`${option.text}, ${count} ${count === 1 ? 'vote' : 'votes'}${chosen ? ', your choice' : ''}`}
                className={cn(
                  'relative block w-full overflow-hidden rounded-lg border px-3 py-1.5 text-left text-sm',
                  chosen ? 'border-current' : 'border-current/25',
                )}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-current opacity-20"
                  style={{ width: `${voters ? (count / voters) * 100 : 0}%` }}
                  aria-hidden="true"
                />
                <span className="relative flex justify-between gap-2">
                  <span className="[overflow-wrap:anywhere]">{option.text}</span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-xs opacity-70">
        {voters} {voters === 1 ? 'voter' : 'voters'}
      </p>
    </div>
  );
};
