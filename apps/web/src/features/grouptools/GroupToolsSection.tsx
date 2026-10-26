// Group info extras: welcome text, slow mode, expense balances, and the admin tools
// (flagged messages, activity numbers, mood summary) plus the icebreaker for a quiet group.
import { useEffect, useMemo, useState } from 'react';
import {
  ENDPOINTS,
  type AnalyticsResponse,
  type ConversationSummary,
  type FlaggedMessage,
  type GroupToolsSettings,
  type UpdateGroupToolsRequest,
} from '@chat/contracts';
import type { z } from 'zod';
import { Button, notify } from '@/components/ui';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { sendMessage } from '../chat/outbox/useOutboxStore';
import { useChatStore, userName } from '../chat/useChatStore';
import { balances, formatMoney, type ExpenseLike } from './expense';

type Settings = z.infer<typeof GroupToolsSettings>;
type Flagged = z.infer<typeof FlaggedMessage>;
type Analytics = z.infer<typeof AnalyticsResponse>;

const SLOW_CHOICES = [
  [0, 'Off'],
  [10, '10 seconds'],
  [30, '30 seconds'],
  [60, '1 minute'],
  [300, '5 minutes'],
] as const;
const QUIET_MS = 3 * 24 * 3_600_000;

const Heading = ({ children }: { children: string }) => (
  <h3 className="mb-2 mt-4 text-sm font-semibold text-base-content/60">{children}</h3>
);

const useAiTask = (conversationId: string, task: 'mood' | 'icebreaker') => {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await getApi().call(ENDPOINTS.groupTools.ai, {
        params: { conversation_id: conversationId },
        body: { task },
      });
      setText(res.text);
    } catch (error) {
      notify.error(getErrorMessage(error, "Flick couldn't do that."));
    } finally {
      setBusy(false);
    }
  };
  return { text, busy, run };
};

export const GroupToolsSection = ({ conversation }: { conversation: ConversationSummary }) => {
  const id = conversation.id;
  const myId = useSessionStore((s) => s.user?.id);
  const aiOn = useAiEnabled();
  const isAdmin = conversation.my_role !== 'member';
  const messages = useChatStore((s) => s.threads[id]?.messages);
  const users = useChatStore((s) => s.users);
  const members = useChatStore((s) => s.members[id]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [welcome, setWelcome] = useState('');
  const [flagged, setFlagged] = useState<Flagged[] | null>(null);
  const [stats, setStats] = useState<Analytics | null>(null);
  const mood = useAiTask(id, 'mood');
  const icebreaker = useAiTask(id, 'icebreaker');
  const params = { conversation_id: id };

  useEffect(() => {
    let alive = true;
    getApi()
      .call(ENDPOINTS.groupTools.get, { params })
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setWelcome(s.welcome_text ?? '');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async (patch: z.infer<typeof UpdateGroupToolsRequest>) => {
    try {
      setSettings(await getApi().call(ENDPOINTS.groupTools.update, { params, body: patch }));
      notify.success('Saved');
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't save."));
    }
  };

  // Running balance from the expense cards in the messages loaded for this chat.
  const owed = useMemo(() => {
    const list: ExpenseLike[] = [];
    for (const m of messages ?? []) {
      if (m.content?.type === 'expense' && !m.deleted_at) list.push(m.content);
    }
    return list.length ? balances(list) : null;
  }, [messages]);
  const nameOf = (uid: string): string =>
    uid === myId
      ? 'You'
      : (members?.find((m) => m.user.id === uid)?.user.display_name ?? userName(users, uid));

  const [openedAt] = useState(() => Date.now());
  const lastMessage = messages?.at(-1);
  const lastAt = lastMessage ? new Date(lastMessage.created_at).getTime() : null;
  const quiet = lastAt !== null && openedAt - lastAt > QUIET_MS;

  const loadFlagged = async (): Promise<void> => {
    try {
      setFlagged((await getApi().call(ENDPOINTS.groupTools.flagged, { params })).items);
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't load flagged messages."));
    }
  };
  const loadStats = async (): Promise<void> => {
    try {
      setStats(await getApi().call(ENDPOINTS.groupTools.analytics, { params }));
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't load activity."));
    }
  };
  const del = async (m: Flagged): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.messages.delete, {
        params: { conversation_id: id, message_id: m.message_id },
        query: { for: 'everyone' },
      });
      setFlagged((list) => (list ?? []).filter((x) => x.message_id !== m.message_id));
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't delete the message."));
    }
  };

  const maxHour = stats ? Math.max(1, ...stats.busiest_hours) : 1;

  return (
    <section aria-label="Group tools" className="mt-2">
      {settings?.welcome_text && !isAdmin && (
        <>
          <Heading>Welcome and rules</Heading>
          <p className="whitespace-pre-wrap rounded-xl bg-base-content/5 p-3 text-sm">
            {settings.welcome_text}
          </p>
        </>
      )}

      {owed && (
        <>
          <Heading>Expense balances</Heading>
          <ul className="text-sm">
            {Object.entries(owed).map(([uid, cents]) => (
              <li key={uid} className="flex justify-between py-0.5">
                <span>{nameOf(uid)}</span>
                <span className={cents < 0 ? 'text-error' : 'text-success'}>
                  {cents < 0 ? 'owes ' : 'is owed '}
                  {formatMoney(Math.abs(cents))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {aiOn && quiet && (
        <>
          <Heading>This group is quiet</Heading>
          {icebreaker.text === null ? (
            <Button
              variant="dashed"
              loading={icebreaker.busy}
              onClick={() => void icebreaker.run()}
            >
              Suggest an icebreaker
            </Button>
          ) : (
            <div className="rounded-xl bg-primary/10 p-3 text-sm">
              <p className="mb-2 whitespace-pre-wrap">{icebreaker.text}</p>
              <Button
                variant="gradient"
                size="sm"
                onClick={() => {
                  const icebreakerText = icebreaker.text;
                  if (myId && icebreakerText)
                    sendMessage(myId, id, { type: 'text', text: icebreakerText.slice(0, 2000) });
                }}
              >
                Send to the group
              </Button>
            </div>
          )}
        </>
      )}

      {isAdmin && (
        <>
          <Heading>Welcome message and rules</Heading>
          <textarea
            className="input-soft w-full"
            rows={3}
            maxLength={1000}
            aria-label="Welcome message and rules"
            placeholder="Shown to new members when they join"
            value={welcome}
            onChange={(e) => {
              setWelcome(e.target.value);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            className="mt-1"
            disabled={welcome === (settings?.welcome_text ?? '')}
            onClick={() => void save({ welcome_text: welcome.trim() || null })}
          >
            Save welcome text
          </Button>

          <Heading>Slow mode</Heading>
          <label className="flex items-center justify-between text-sm">
            Time between messages per member
            <select
              className="select select-bordered select-sm"
              value={settings?.slow_mode_seconds ?? 0}
              onChange={(e) => void save({ slow_mode_seconds: Number(e.target.value) })}
            >
              {SLOW_CHOICES.map(([s, label]) => (
                <option key={s} value={s}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <Heading>Flagged messages</Heading>
          {flagged === null ? (
            <Button variant="dashed" size="sm" onClick={() => void loadFlagged()}>
              Scan recent messages
            </Button>
          ) : flagged.length === 0 ? (
            <p className="text-sm text-base-content/60">Nothing flagged.</p>
          ) : (
            <ul className="space-y-2">
              {flagged.map((m) => (
                <li key={m.message_id} className="rounded-xl bg-warning/10 p-2 text-sm">
                  <p className="font-semibold">{m.sender_name}</p>
                  <p className="break-words">{m.text}</p>
                  <p className="text-xs opacity-70">{m.reasons.join(', ')}</p>
                  <div className="mt-1 flex gap-2">
                    <Button variant="danger" size="sm" onClick={() => void del(m)}>
                      Delete
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFlagged((list) =>
                          (list ?? []).filter((x) => x.message_id !== m.message_id),
                        );
                      }}
                    >
                      Dismiss
                    </Button>
                    {m.sender_id && m.sender_id !== myId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-error"
                        onClick={() => {
                          if (m.sender_id)
                            void useChatStore.getState().removeMember(id, m.sender_id);
                        }}
                      >
                        Remove sender
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Heading>Activity (last 30 days)</Heading>
          {stats === null ? (
            <Button variant="dashed" size="sm" onClick={() => void loadStats()}>
              Show analytics
            </Button>
          ) : (
            <div className="text-sm">
              <p className="mb-1">{stats.total} messages</p>
              <ol className="mb-2">
                {stats.top_members.map((t) => (
                  <li key={t.user_id} className="flex justify-between">
                    <span>{t.name}</span>
                    <span>{t.count}</span>
                  </li>
                ))}
              </ol>
              <div
                className="flex h-16 items-end gap-px"
                role="img"
                aria-label="Messages by hour of day (UTC)"
              >
                {stats.busiest_hours.map((n, h) => (
                  <div
                    key={h}
                    title={`${String(h)}:00 UTC: ${String(n)}`}
                    className="flex-1 rounded-t bg-primary/70"
                    style={{ height: `${String(Math.max(4, (n / maxHour) * 100))}%` }}
                  />
                ))}
              </div>
              <p className="text-xs opacity-60">Busiest hours, 0 to 23 UTC</p>
            </div>
          )}

          {aiOn && (
            <>
              <Heading>Weekly mood summary</Heading>
              {mood.text === null ? (
                <Button
                  variant="dashed"
                  size="sm"
                  loading={mood.busy}
                  onClick={() => void mood.run()}
                >
                  Summarise the mood
                </Button>
              ) : (
                <p className="whitespace-pre-wrap rounded-xl bg-primary/10 p-3 text-sm">
                  {mood.text}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
};
