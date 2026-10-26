import { useEffect, useState, type FormEvent } from 'react';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { Result, Shell } from './UnderstandParts';
import { useUnderstand } from './useUnderstand';

interface Props {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}

/** "Topics": the chat grouped into topics; tap one to jump to where it starts. */
export const TopicsDialog = ({ conversationId, open, onClose }: Props) => {
  const enabled = useAiEnabled();
  const { state, run, reset } = useUnderstand();
  useEffect(() => {
    if (!open || enabled !== true) return;
    run({ mode: 'topics', conversation_id: conversationId });
    return reset;
  }, [open, enabled, conversationId, run, reset]);
  return (
    <Shell title="Topics" open={open} onClose={onClose}>
      {enabled === false ? (
        <p role="status">AI is not set up on this server.</p>
      ) : (
        <Result state={state} onJump={onClose} />
      )}
    </Shell>
  );
};

const RANGES = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 3 months', days: 90 },
  { id: 'all', label: 'Everything', days: 0 },
] as const;

/** "What did we agree on this month?": a date range and a question about this chat. */
export const RecapDialog = ({ conversationId, open, onClose }: Props) => {
  const enabled = useAiEnabled();
  const { state, run, reset } = useUnderstand();
  const [question, setQuestion] = useState('What did we agree on?');
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('30');
  useEffect(() => (open ? reset : undefined), [open, reset]);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const days = RANGES.find((r) => r.id === range)?.days ?? 0;
    run({
      mode: 'recap',
      conversation_id: conversationId,
      question,
      ...(days ? { from: new Date(Date.now() - days * 86_400_000).toISOString() } : {}),
    });
  };
  return (
    <Shell title="Recap with Flick" open={open} onClose={onClose}>
      {enabled === false ? (
        <p role="status">AI is not set up on this server.</p>
      ) : (
        <>
          <form onSubmit={submit} className="flex flex-col gap-2">
            <select
              aria-label="Period"
              className="select select-bordered min-h-[44px]"
              value={range}
              onChange={(e) => {
                setRange(e.target.value as typeof range);
              }}
            >
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Question"
              className="input input-bordered min-h-[44px]"
              value={question}
              maxLength={300}
              onChange={(e) => {
                setQuestion(e.target.value);
              }}
            />
            <button
              type="submit"
              className="btn btn-primary min-h-[44px]"
              disabled={question.trim().length < 2 || state.status === 'loading'}
            >
              Ask
            </button>
          </form>
          <Result state={state} />
        </>
      )}
    </Shell>
  );
};

/** "Check this" / "Check with AI": checks a claim or link in one message, or how it comes across. */
export const CheckDialog = ({
  conversationId,
  messageId,
  aspect,
  open,
  onClose,
}: Props & { messageId: string; aspect: 'facts' | 'mood' }) => {
  const enabled = useAiEnabled();
  const { state, run, reset } = useUnderstand();
  useEffect(() => {
    if (!open || enabled !== true) return;
    run({ mode: 'check', conversation_id: conversationId, message_id: messageId, aspect });
    return reset;
  }, [open, enabled, conversationId, messageId, aspect, run, reset]);
  return (
    <Shell
      title={aspect === 'mood' ? 'How this reads' : 'Check this'}
      open={open}
      onClose={onClose}
    >
      {enabled === false ? (
        <p role="status">AI is not set up on this server.</p>
      ) : (
        <Result state={state} />
      )}
    </Shell>
  );
};
