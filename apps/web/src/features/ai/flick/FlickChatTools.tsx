import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain,
  Copy,
  Gauge,
  ListTree,
  Plus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { type MessageRecord } from '@chat/contracts';
import { cn, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { sendMessage } from '@/features/chat/outbox/useOutboxStore';
import { isFlickBot } from '../isFlickBot';
import { useAiEnabled } from '../useAiEnabled';
import { HoldToTalk } from './HoldToTalk';
import { TopicsDialog } from './TopicsDialog';
import { getFollowups, getSpeed, sendFeedback, setSpeed } from './flickApi';
import { canSpeak, speak, stopSpeaking, useFollowupSetting, useReadAloud } from './flickSettings';
import { useFlickTopics } from './useFlickTopics';

const textOf = (m: MessageRecord | undefined): string | null =>
  m?.content?.type === 'text' ? m.content.text : null;

const Pill = ({
  children,
  pressed,
  className,
  ...rest
}: {
  children: React.ReactNode;
  pressed?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    aria-pressed={pressed}
    className={cn(
      'flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
      pressed ? 'bg-primary text-primary-content' : 'bg-sunken text-primary-text',
      className,
    )}
    {...rest}
  >
    {children}
  </button>
);

/**
 * Everything extra in the chat with Flick, above the composer: new topic / topics, fast or smart
 * answers, read aloud, hold to talk, and under the latest answer Copy, Regenerate, thumbs and
 * follow-up suggestions.
 */
export const FlickChatTools = ({
  conversationId,
  myId,
  messages,
}: {
  conversationId: string;
  myId: string;
  messages: readonly MessageRecord[];
}) => {
  const enabled = useAiEnabled();
  const [readAloud, setReadAloud] = useReadAloud();
  const [followupsOn] = useFollowupSetting();
  const startTopic = useFlickTopics((s) => s.start);
  const loadTopics = useFlickTopics((s) => s.load);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [speed, setSpeedState] = useState<'fast' | 'quality'>('quality');
  const [rated, setRated] = useState<Record<string, 'up' | 'down'>>({});
  const [followups, setFollowups] = useState<{ id: string; items: string[] } | null>(null);

  useEffect(() => {
    void loadTopics();
    getSpeed().then(setSpeedState, () => undefined);
  }, [loadTopics]);

  const last = messages.at(-1);
  const latestReply =
    last && isFlickBot(last.sender_user_id, null) && textOf(last) ? last : undefined;
  const latestId = latestReply?.message_id;
  const latestAt = latestReply?.created_at ?? '';

  // Speak new replies only (not the history that is there when the chat opens).
  const spoken = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (spoken.current === undefined) {
      spoken.current = latestId ?? null;
      return;
    }
    if (!latestId || latestId === spoken.current) return;
    spoken.current = latestId;
    const text = textOf(latestReply);
    if (readAloud && text) speak(text);
  }, [latestId, latestReply, readAloud]);
  useEffect(() => stopSpeaking, []); // leaving the chat stops the voice

  // Follow-up chips are asked for only after a NEW reply arrives in this session (never for the
  // history that is there when the chat opens), and only when the setting is on: every ask costs
  // one AI call from the daily quota.
  const [opened] = useState(() => Date.now());
  const knownReply = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (knownReply.current === undefined) {
      knownReply.current = latestId ?? null; // the reply already there when the chat opened
      return;
    }
    if (!latestId || latestId === knownReply.current) return;
    knownReply.current = latestId;
    // History that loads late is old; only a reply sent since the chat opened counts as new.
    if (!(Date.parse(latestAt) >= opened - 60_000) || !followupsOn || enabled === false) return;
    getFollowups(latestId).then(
      (items) => {
        setFollowups({ id: latestId, items }); // chips only show while this is still the latest id
      },
      () => undefined,
    );
  }, [latestId, latestAt, followupsOn, enabled, opened]);

  if (enabled === false) return null;

  const ask = (text: string): void => {
    sendMessage(myId, conversationId, { type: 'text', text });
  };

  const regenerate = (): void => {
    const before = latestReply ? messages.slice(0, messages.indexOf(latestReply)) : [];
    const question = [...before].reverse().find((m) => m.sender_user_id === myId && textOf(m));
    const text = textOf(question);
    if (text) ask(text);
    else notify.info('There is no question to ask again.');
  };

  const rate = (rating: 'up' | 'down'): void => {
    if (!latestId) return;
    setRated((r) => ({ ...r, [latestId]: rating }));
    sendFeedback(latestId, rating).catch((e: unknown) => {
      setRated((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== latestId)));
      notify.error(getErrorMessage(e, "Couldn't save your feedback."));
    });
  };

  const copy = (): void => {
    const text = textOf(latestReply);
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => {
        notify.success('Copied.');
      },
      () => {
        notify.error("Couldn't copy.");
      },
    );
  };

  const chips = followups?.id === latestId ? followups?.items : [];
  const myRating = latestId ? rated[latestId] : undefined;

  return (
    <div
      className="border-t border-base-content/10 bg-base-100 px-3 py-2"
      data-testid="flick-tools"
    >
      {latestReply && (
        <div className="mb-2 space-y-2">
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Actions for Flick's latest answer"
          >
            <button type="button" className="btn btn-ghost btn-xs gap-1" onClick={copy}>
              <Copy className="size-3.5" aria-hidden="true" /> Copy
            </button>
            <button type="button" className="btn btn-ghost btn-xs gap-1" onClick={regenerate}>
              <RefreshCw className="size-3.5" aria-hidden="true" /> Regenerate
            </button>
            <button
              type="button"
              className={cn('btn btn-ghost btn-xs btn-circle', myRating === 'up' && 'text-primary')}
              aria-label="Good answer"
              aria-pressed={myRating === 'up'}
              onClick={() => {
                rate('up');
              }}
            >
              <ThumbsUp className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={cn('btn btn-ghost btn-xs btn-circle', myRating === 'down' && 'text-error')}
              aria-label="Bad answer"
              aria-pressed={myRating === 'down'}
              onClick={() => {
                rate('down');
              }}
            >
              <ThumbsDown className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          {followupsOn && chips && chips.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Follow-up suggestions">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rounded-full border border-base-content/10 bg-sunken px-3 py-1 text-sm text-primary-text"
                  onClick={() => {
                    ask(c);
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        <HoldToTalk onText={ask} />
        <Pill
          onClick={() => {
            startTopic().then(
              () => {
                notify.success('New topic. Flick starts fresh from your next message.');
              },
              (e: unknown) => {
                notify.error(getErrorMessage(e, "Couldn't start a new topic."));
              },
            );
          }}
        >
          <Plus className="size-4" aria-hidden="true" /> New topic
        </Pill>
        <Pill
          onClick={() => {
            setTopicsOpen(true);
          }}
        >
          <ListTree className="size-4" aria-hidden="true" /> Topics
        </Pill>
        <Pill
          pressed={speed === 'fast'}
          aria-label={
            speed === 'fast' ? 'Fast answers (tap for smart)' : 'Smart answers (tap for fast)'
          }
          onClick={() => {
            const next = speed === 'fast' ? 'quality' : 'fast';
            setSpeedState(next);
            setSpeed(next).catch((e: unknown) => {
              setSpeedState(speed);
              notify.error(getErrorMessage(e, "Couldn't change the model."));
            });
          }}
        >
          <Gauge className="size-4" aria-hidden="true" /> {speed === 'fast' ? 'Fast' : 'Smart'}
        </Pill>
        {canSpeak() && (
          <>
            <Pill
              pressed={readAloud}
              onClick={() => {
                if (readAloud) stopSpeaking();
                setReadAloud(!readAloud);
              }}
            >
              <Volume2 className="size-4" aria-hidden="true" /> Read aloud
            </Pill>
            {readAloud && (
              <Pill aria-label="Stop reading" onClick={stopSpeaking}>
                <VolumeX className="size-4" aria-hidden="true" /> Stop
              </Pill>
            )}
          </>
        )}
        <Link
          to="/memory"
          className="flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-sunken px-3 text-sm font-medium text-primary-text"
        >
          <Brain className="size-4" aria-hidden="true" /> Memory
        </Link>
      </div>
      <TopicsDialog
        open={topicsOpen}
        onClose={() => {
          setTopicsOpen(false);
        }}
        messages={messages}
      />
    </div>
  );
};
