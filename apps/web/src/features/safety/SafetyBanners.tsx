// Banners above the message list: scam warning and look-alike name for strangers, the group's
// welcome text for new members, and the slow-mode wait. Each can be dismissed.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ShieldAlert, Timer, UserX } from 'lucide-react';
import { ENDPOINTS, type ConversationSummary, type MessageRecord } from '@chat/contracts';
import { Button, notify } from '@/components/ui';
import { isFlickChat } from '@/features/ai/isFlickBot';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useChatStore } from '../chat/useChatStore';
import { findImpersonated } from './impersonation';
import { SCAM_THRESHOLD, scamScore } from './scam';

const dismissedKey = (kind: string, id: string): string => `flick.safety.${kind}.${id}`;
const isDismissed = (kind: string, id: string): boolean => {
  try {
    return localStorage.getItem(dismissedKey(kind, id)) === '1';
  } catch {
    return false;
  }
};
const remember = (kind: string, id: string): void => {
  try {
    localStorage.setItem(dismissedKey(kind, id), '1');
  } catch {
    // private window: the banner just comes back next time
  }
};

/** When I last sent a message here (ms), or null. */
const lastOwnMessageAt = (
  messages: readonly MessageRecord[] | undefined,
  myId: string | undefined,
): number | null => {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.sender_user_id === myId && !m.deleted_at) return new Date(m.created_at).getTime();
  }
  return null;
};

const Banner = ({
  icon,
  tone,
  children,
}: {
  icon: ReactNode;
  tone: string;
  children: ReactNode;
}) => (
  <div role="alert" className={`mx-3 mt-2 flex items-start gap-3 rounded-2xl p-3 text-sm ${tone}`}>
    <span className="mt-0.5 shrink-0">{icon}</span>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

export const SafetyBanners = ({
  conversation,
  messages,
}: {
  conversation: ConversationSummary;
  messages: readonly MessageRecord[] | undefined;
}) => {
  const id = conversation.id;
  const myId = useSessionStore((s) => s.user?.id);
  const conversations = useChatStore((s) => s.conversations);
  const [, bump] = useState(0);
  const [settings, setSettings] = useState<{
    slow_mode_seconds: number;
    welcome_text: string | null;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const isGroup = conversation.type === 'group';
  const peer = conversation.peer;
  const stranger =
    !isGroup &&
    Boolean(peer) &&
    !conversation.is_saved &&
    !isFlickChat(conversation) &&
    messages !== undefined &&
    !messages.some((m) => m.sender_user_id === myId);

  useEffect(() => {
    if (!isGroup) return;
    let alive = true;
    getApi()
      .call(ENDPOINTS.groupTools.get, { params: { conversation_id: id } })
      .then((s) => alive && setSettings(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isGroup, id]);

  const lastMine = lastOwnMessageAt(messages, myId);
  const slow = conversation.my_role === 'member' ? (settings?.slow_mode_seconds ?? 0) : 0;
  const wait = slow && lastMine ? Math.max(0, Math.ceil((lastMine + slow * 1000 - now) / 1000)) : 0;
  const waiting = wait > 0;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [waiting]);

  const scam = useMemo(() => {
    if (!stranger) return null;
    let best = { score: 0, reasons: [] as string[] };
    for (const m of messages) {
      if (m.content?.type !== 'text') continue;
      const r = scamScore(m.content.text);
      if (r.score > best.score) best = r;
    }
    return best.score >= SCAM_THRESHOLD ? best : null;
  }, [stranger, messages]);

  const lookalike = useMemo(() => {
    if (!stranger || !peer) return null;
    const known = Object.values(conversations).flatMap((c) =>
      c.id !== id && c.type === 'direct' && c.peer ? [c.peer.display_name] : [],
    );
    return findImpersonated(peer.display_name, known);
  }, [stranger, peer, conversations, id]);

  const blockAndReport = async (): Promise<void> => {
    if (!peer) return;
    try {
      await getApi().call(ENDPOINTS.moderation.report, {
        body: { user_id: peer.id, conversation_id: id, reason: 'scam', block: true },
      });
      remember('scam', id);
      bump((n) => n + 1);
      notify.success('Blocked and reported');
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't report this person."));
    }
  };

  const welcome = isGroup && settings?.welcome_text && !isDismissed('welcome', id);

  return (
    <>
      {scam && !isDismissed('scam', id) && (
        <Banner
          icon={<ShieldAlert className="size-5" aria-hidden="true" />}
          tone="bg-error/15 text-error-content"
        >
          <p className="font-semibold text-error">This looks like a scam</p>
          <p className="text-base-content/80">
            {peer?.display_name} is not someone you have chatted with, and the message{' '}
            {scam.reasons.join(', ')}.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="danger" size="sm" onClick={() => void blockAndReport()}>
              Block and report
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                remember('scam', id);
                bump((n) => n + 1);
              }}
            >
              Dismiss
            </Button>
          </div>
        </Banner>
      )}
      {lookalike && !isDismissed('impersonation', id) && (
        <Banner icon={<UserX className="size-5" aria-hidden="true" />} tone="bg-warning/15">
          <p className="font-semibold">Is this really {lookalike}?</p>
          <p className="text-base-content/80">
            This person&apos;s name looks like someone you already chat with, but it is a different
            account.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1"
            onClick={() => {
              remember('impersonation', id);
              bump((n) => n + 1);
            }}
          >
            Dismiss
          </Button>
        </Banner>
      )}
      {welcome && (
        <Banner icon={<span aria-hidden="true">👋</span>} tone="bg-primary/10">
          <p className="font-semibold">Welcome to {conversation.title ?? 'the group'}</p>
          <p className="whitespace-pre-wrap text-base-content/80">{settings.welcome_text}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1"
            onClick={() => {
              remember('welcome', id);
              bump((n) => n + 1);
            }}
          >
            Got it
          </Button>
        </Banner>
      )}
      {slow > 0 && (
        <Banner icon={<Timer className="size-5" aria-hidden="true" />} tone="bg-base-content/5">
          <p role="status">
            Slow mode: {slow}s between messages
            {wait > 0 ? `. You can send again in ${String(wait)}s.` : '.'}
          </p>
        </Banner>
      )}
    </>
  );
};
