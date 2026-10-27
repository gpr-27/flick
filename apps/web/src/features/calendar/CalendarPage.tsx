import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { ENDPOINTS, type ScheduledMessage } from '@chat/contracts';
import { notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useReminderStore } from '@/features/reminders/reminderStore';
import { parsePicked, toInputValue } from '@/features/scheduled/times';
import { CalendarEvents } from './CalendarEvents';
import { addMonths, dayKey, groupByDay, monthGrid, type CalendarItem } from './month';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month view of the reminders and scheduled messages that are still waiting. */
export const CalendarPage = () => {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selected, setSelected] = useState(dayKey(now));
  const reminders = useReminderStore((s) => s.items);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [editing, setEditing] = useState<CalendarItem | null>(null);
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');

  useEffect(() => {
    void useReminderStore.getState().load();
    getApi()
      .call(ENDPOINTS.scheduled.list)
      .then(
        (res) => {
          setScheduled(res.items);
        },
        (e: unknown) => {
          notify.error(getErrorMessage(e, "Couldn't load your scheduled messages."));
        },
      );
  }, []);

  const items = useMemo<CalendarItem[]>(
    () => [
      ...reminders
        .filter((r) => r.status === 'pending')
        .map((r) => ({
          id: r.id,
          kind: 'reminder' as const,
          at: r.remind_at,
          title: r.note ?? r.quote ?? `Reminder: ${r.chat_name}`,
        })),
      ...scheduled
        .filter((m) => m.status === 'pending')
        .map((m) => ({ id: m.id, kind: 'scheduled' as const, at: m.send_at, title: m.text })),
    ],
    [reminders, scheduled],
  );
  const byDay = useMemo(() => groupByDay(items), [items]);
  const dayItems = byDay.get(selected) ?? [];

  const remove = async (item: CalendarItem): Promise<void> => {
    try {
      if (item.kind === 'reminder') {
        await getApi().call(ENDPOINTS.reminders.cancel, { params: { reminder_id: item.id } });
        useReminderStore.getState().remove(item.id);
      } else {
        await getApi().call(ENDPOINTS.scheduled.cancel, { params: { scheduled_id: item.id } });
        setScheduled((l) => l.filter((m) => m.id !== item.id));
      }
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't delete that."));
    }
  };

  const startEdit = (item: CalendarItem): void => {
    setEditing(item);
    setText(item.title);
    setWhen(toInputValue(new Date(item.at)));
  };

  const save = async (item: CalendarItem): Promise<void> => {
    const picked = parsePicked(when, new Date());
    if (!picked.ok) {
      notify.error(picked.error);
      return;
    }
    try {
      if (item.kind === 'scheduled') {
        const updated = await getApi().call(ENDPOINTS.scheduled.update, {
          params: { scheduled_id: item.id },
          body: { text: text.trim(), send_at: picked.at.toISOString() },
        });
        setScheduled((l) => l.map((m) => (m.id === item.id ? updated : m)));
      } else {
        // Reminders have no edit call: replace the old one with a new one.
        const old = reminders.find((r) => r.id === item.id);
        if (!old) return;
        const created = await getApi().call(ENDPOINTS.reminders.create, {
          body: {
            conversation_id: old.conversation_id,
            ...(old.message_id ? { message_id: old.message_id } : {}),
            remind_at: picked.at.toISOString(),
            ...(text.trim() ? { note: text.trim() } : {}),
          },
        });
        await getApi().call(ENDPOINTS.reminders.cancel, { params: { reminder_id: old.id } });
        useReminderStore.getState().remove(old.id);
        useReminderStore.getState().add(created);
      }
      setEditing(null);
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't save the change."));
    }
  };

  const title = new Date(ym.year, ym.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const today = dayKey(now);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-8 pt-[calc(5rem+env(safe-area-inset-top))]">
      <div className="glass-card rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm"
            aria-label="Previous month"
            onClick={() => {
              setYm((v) => addMonths(v.year, v.month, -1));
            }}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <h1 className="text-xl font-semibold">{title}</h1>
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm"
            aria-label="Next month"
            onClick={() => {
              setYm((v) => addMonths(v.year, v.month, 1));
            }}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-base-content/60">
          {WEEKDAYS.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {monthGrid(ym.year, ym.month).map((d) => {
            const key = dayKey(d);
            const list = byDay.get(key) ?? [];
            return (
              <button
                key={key}
                type="button"
                aria-label={`${d.toDateString()}, ${String(list.length)} items`}
                aria-pressed={key === selected}
                aria-current={key === today ? 'date' : undefined}
                onClick={() => {
                  setSelected(key);
                  setEditing(null);
                }}
                className={`flex h-12 flex-col items-center justify-center rounded-xl text-sm ${
                  key === selected ? 'bg-primary text-primary-content' : 'hover:bg-base-content/5'
                } ${d.getMonth() !== ym.month ? 'opacity-40' : ''} ${
                  key === today ? 'font-bold ring-1 ring-primary' : ''
                }`}
              >
                {d.getDate()}
                <span className="flex h-2 gap-0.5" aria-hidden="true">
                  {list.slice(0, 3).map((i) => (
                    <span
                      key={i.id}
                      className={`size-1.5 rounded-full ${i.kind === 'reminder' ? 'bg-warning' : 'bg-info'}`}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-4 space-y-2" aria-label="Items on the selected day">
        {dayItems.length === 0 && (
          <li className="text-sm text-base-content/60">Nothing on this day.</li>
        )}
        {dayItems.map((item) => (
          <li key={item.id} className="glass-card rounded-2xl p-3 text-sm">
            {editing?.id === item.id ? (
              <div className="space-y-2">
                <textarea
                  className="textarea textarea-bordered w-full"
                  aria-label={item.kind === 'reminder' ? 'Note' : 'Message text'}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
                <input
                  type="datetime-local"
                  className="input input-bordered w-full"
                  aria-label="Time"
                  value={when}
                  onChange={(e) => {
                    setWhen(e.target.value);
                  }}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEditing(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void save(item)}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-base-content/60">
                    {item.kind === 'reminder' ? 'Reminder' : 'Scheduled message'} at{' '}
                    {new Date(item.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="line-clamp-2 break-words">{stripMarkdown(item.title)}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-circle btn-ghost btn-sm"
                  aria-label="Edit"
                  onClick={() => {
                    startEdit(item);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn btn-circle btn-ghost btn-sm"
                  aria-label="Delete"
                  onClick={() => void remove(item)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <CalendarEvents selected={selected} />
    </main>
  );
};
