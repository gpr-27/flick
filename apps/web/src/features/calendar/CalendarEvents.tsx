import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { useNavigate } from 'react-router-dom';
import { getApi } from '@/lib/services';
import { dayKey } from './month';

type EventItem = {
  message_id: string;
  conversation_id: string;
  title: string;
  starts_at: string;
  place: string | null;
  mine: 'going' | 'maybe' | 'no' | null;
};

/** Shared events (Event cards from your chats) on the selected day. */
export const CalendarEvents = ({ selected }: { selected: string }) => {
  const [events, setEvents] = useState<EventItem[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    getApi()
      .call(ENDPOINTS.productivity.listEvents)
      .then(
        (r) => setEvents(r.items),
        () => undefined,
      );
  }, []);

  const today = events.filter((e) => dayKey(new Date(e.starts_at)) === selected);
  if (today.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2" aria-label="Events on the selected day">
      {today.map((e) => (
        <li key={e.message_id} className="glass-card rounded-2xl p-3 text-sm">
          <button
            type="button"
            className="w-full text-left"
            onClick={() => {
              navigate(`/?c=${e.conversation_id}`);
            }}
          >
            <p className="flex items-center gap-1 text-xs font-semibold text-base-content/60">
              <CalendarDays className="size-3" aria-hidden="true" /> Event at{' '}
              {new Date(e.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {e.mine ? ` · ${e.mine}` : ''}
            </p>
            <p className="break-words">
              {e.title}
              {e.place ? ` · ${e.place}` : ''}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
};
