import { useEffect, useState } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { cn, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

type Answer = 'going' | 'maybe' | 'no';
type Summary = { going: number; maybe: number; no: number; mine: Answer | null };
const LABELS: Record<Answer, string> = { going: 'Going', maybe: 'Maybe', no: 'No' };

/** The Event card in a chat: title, time, place and Going / Maybe / No. */
export const EventCard = ({
  title,
  startsAt,
  place,
  messageId,
}: {
  title: string;
  startsAt: string;
  place?: string;
  messageId?: string;
}) => {
  const [summary, setSummary] = useState<Summary | null>(null);
  // A message still in the outbox has no server id yet, so there is nothing to answer.
  const sent = messageId !== undefined && !messageId.startsWith('local:');

  useEffect(() => {
    if (!sent) return;
    getApi()
      .call(ENDPOINTS.productivity.rsvps, { params: { message_id: messageId } })
      .then(setSummary, () => undefined);
  }, [sent, messageId]);

  const answer = async (response: Answer): Promise<void> => {
    if (!sent) return;
    try {
      setSummary(
        await getApi().call(ENDPOINTS.productivity.rsvp, {
          params: { message_id: messageId },
          body: { response },
        }),
      );
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't save your answer."));
    }
  };

  return (
    <div className="flex min-w-[14rem] flex-col gap-2">
      <p className="flex items-center gap-2 font-semibold">
        <CalendarDays className="size-4 shrink-0" aria-hidden="true" /> {title}
      </p>
      <p className="text-sm">
        {new Date(startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
      {place && (
        <p className="flex items-center gap-1 text-sm opacity-80">
          <MapPin className="size-4 shrink-0" aria-hidden="true" /> {place}
        </p>
      )}
      <div className="flex gap-1" role="group" aria-label="Your answer">
        {(Object.keys(LABELS) as Answer[]).map((a) => (
          <button
            key={a}
            type="button"
            disabled={!sent}
            aria-pressed={summary?.mine === a}
            className={cn('btn btn-xs', summary?.mine === a ? 'btn-primary' : 'btn-outline')}
            onClick={() => void answer(a)}
          >
            {LABELS[a]}
            {summary ? ` ${summary[a]}` : ''}
          </button>
        ))}
      </div>
    </div>
  );
};
