import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Sunrise } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ENDPOINTS, type Digest } from '@chat/contracts';
import { getApi } from '@/lib/services';

// The card is collapsed by default; the choice is a per-device convenience.
const KEY = 'flick.digest.open';
const readOpen = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** A collapsible morning briefing at the top of the chat list: due reminders, waiting chats, saved items. */
export const DigestCard = ({ onOpenChat }: { onOpenChat: (conversationId: string) => void }) => {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [open, setOpen] = useState(readOpen);

  useEffect(() => {
    getApi()
      .call(ENDPOINTS.productivity.digest)
      .then(
        // Anything that is not a briefing (an empty reply) shows nothing.
        (d: Partial<Digest> | undefined) => {
          setDigest(
            Array.isArray(d?.reminders_due) && Array.isArray(d.unread_chats) ? (d as Digest) : null,
          );
        },
        () => undefined,
      );
  }, []);

  if (!digest || (digest.reminders_due.length === 0 && digest.unread_chats.length === 0))
    return null;

  const toggle = (): void => {
    setOpen(!open);
    try {
      localStorage.setItem(KEY, open ? '0' : '1');
    } catch {
      // not remembered
    }
  };

  return (
    <section
      className="mx-3 mb-2 rounded-2xl bg-base-content/5 p-3 text-sm"
      aria-label="Your briefing"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 font-semibold"
        aria-expanded={open}
        onClick={toggle}
      >
        <Sunrise className="size-4 text-warning" aria-hidden="true" />
        <span className="flex-1 text-left">
          Your briefing: {digest.reminders_due.length} reminders, {digest.unread_chats.length} chats
          waiting
        </span>
        {open ? (
          <ChevronUp className="size-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {digest.reminders_due.length > 0 && (
            <ul className="flex flex-col gap-1">
              {digest.reminders_due.map((r) => (
                <li key={r.id}>
                  {new Date(r.remind_at).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}{' '}
                  {r.note ?? 'Reminder'}
                </li>
              ))}
            </ul>
          )}
          {digest.unread_chats.map((c) => (
            <button
              key={c.conversation_id}
              type="button"
              className="text-left text-primary-text"
              onClick={() => {
                onOpenChat(c.conversation_id);
              }}
            >
              {c.name}: {c.unread} unread
            </button>
          ))}
          <p className="text-base-content/60">
            {digest.saved_count} saved items ·{' '}
            <Link to="/bookmarks" className="underline">
              Bookmarks
            </Link>
          </p>
        </div>
      )}
    </section>
  );
};
