import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { useEffect, useState } from 'react';
import { AlarmClock } from 'lucide-react';
import { ENDPOINTS, type Nudge } from '@chat/contracts';
import { Button } from '@/components/ui';
import { ReminderDialog } from '@/features/reminders/ReminderDialog';
import { getApi } from '@/lib/services';
import { hintToDate } from './promiseTime';

const KEY = 'flick.nudges.dismissed';
const readDismissed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
};

/** In the notifications centre: "You said you'd… Remind me?" for promises in your sent messages. */
export const NudgeList = () => {
  const [items, setItems] = useState<Nudge[]>([]);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [active, setActive] = useState<Nudge | null>(null);

  useEffect(() => {
    getApi()
      .call(ENDPOINTS.productivity.nudges)
      .then(
        (r) => setItems(r.items),
        () => undefined,
      );
  }, []);

  const dismiss = (id: string): void => {
    const next = [...dismissed, id].slice(-100);
    setDismissed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // not remembered
    }
  };
  const shown = items.filter((n) => !dismissed.includes(n.message_id));
  if (shown.length === 0) return null;

  return (
    <section className="border-b border-base-content/10 px-4 py-3" aria-label="Follow-ups">
      <h2 className="mb-2 text-sm font-semibold">Did you follow up?</h2>
      <ul className="flex flex-col gap-2">
        {shown.map((n) => (
          <li key={n.message_id} className="rounded-xl bg-base-content/5 p-3 text-sm">
            <p className="line-clamp-2">You said: “{stripMarkdown(n.text)}”</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<AlarmClock className="size-4" />}
                onClick={() => setActive(n)}
              >
                Remind me
              </Button>
              <Button variant="ghost" size="sm" onClick={() => dismiss(n.message_id)}>
                Dismiss
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {active && (
        <ReminderDialog
          open
          target={{ conversationId: active.conversation_id, messageId: active.message_id }}
          preview={active.text}
          initialAt={hintToDate(active.when_hint, new Date())?.toISOString()}
          onClose={() => {
            dismiss(active.message_id);
            setActive(null);
          }}
        />
      )}
    </section>
  );
};
