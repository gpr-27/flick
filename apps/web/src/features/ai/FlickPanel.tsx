import { useState, type FormEvent } from 'react';
import { Send, Sparkles, X } from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Modal, Spinner, cn } from '@/components/ui';
import { askFlick, summarizeUnread, type AiChatTurn } from './aiApi';
import { useAiEnabled } from './useAiEnabled';
import { ModelTag } from './ModelTag';
import { useAiTask, type AiTaskState } from './useAiTask';

/** Only the latest turns are sent: the server caps the history and its total size. */
const MAX_TURNS = 20;

const NotConfigured = () => (
  <p role="status" className="rounded-2xl bg-base-content/5 p-4 text-sm text-base-content/70">
    AI is not set up on this server yet. An admin needs to add an AI provider key.
  </p>
);

/** Loading, streamed answer or error for one task. */
const TaskResult = ({ state, label }: { state: AiTaskState; label: string }) => {
  if (state.status === 'idle') return null;
  if (state.status === 'error') {
    return state.notConfigured ? (
      <NotConfigured />
    ) : (
      <p role="alert" className="text-sm text-error">
        {state.error}
      </p>
    );
  }
  return (
    <div className="rounded-2xl bg-base-content/5 p-3 text-sm" aria-label={label}>
      {state.status === 'loading' && !state.text && (
        <span className="flex items-center gap-2 text-base-content/60">
          <Spinner size="sm" label="Flick is thinking" /> Thinking…
        </span>
      )}
      <p className="whitespace-pre-wrap break-words">{state.text}</p>
      <ModelTag label={state.model} className="mt-1" />
    </div>
  );
};

/**
 * "Ask Flick": summarize what you have not read, or ask the assistant a question
 * (optionally with this chat's latest messages as context).
 */
export const FlickPanel = ({
  conversation,
  open,
  onClose,
}: {
  conversation: ConversationSummary;
  open: boolean;
  onClose: () => void;
}) => {
  const enabled = useAiEnabled();
  const summary = useAiTask();
  const answer = useAiTask();
  // `model` is set on the assistant's turns, to show who answered; it is not sent back to the API.
  const [turns, setTurns] = useState<(AiChatTurn & { model?: string })[]>([]);
  const [draft, setDraft] = useState('');
  const [useChat, setUseChat] = useState(true);

  const busy = summary.state.status === 'loading' || answer.state.status === 'loading';

  const summarize = (): void => {
    void summary.run((o) => summarizeUnread(conversation.id, o));
  };

  const ask = (e: FormEvent): void => {
    e.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    const history = [...turns, { role: 'user' as const, content: question }];
    setTurns(history);
    setDraft('');
    void answer
      .run((o) =>
        askFlick(
          history.slice(-MAX_TURNS).map(({ role, content }) => ({ role, content })),
          useChat ? conversation.id : undefined,
          o,
        ),
      )
      .then((text) => {
        if (text) {
          const model = answer.lastModel.current ?? undefined;
          setTurns([...history, { role: 'assistant', content: text, model }]);
        }
      });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="flick-panel-title"
      className="glass-card mx-4 flex max-h-[85vh] w-full max-w-lg flex-col gap-4 rounded-3xl p-6 animate-scale-in"
    >
      <div className="flex items-center justify-between">
        <h2
          id="flick-panel-title"
          className="flex items-center gap-2 font-display text-xl font-bold"
        >
          <Sparkles className="size-5 text-primary" aria-hidden="true" /> Ask Flick
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-circle btn-ghost btn-sm"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      {enabled === null && <Spinner size="lg" label="Checking AI" className="mx-auto" />}
      {enabled === false && <NotConfigured />}

      {enabled && (
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <section className="space-y-2" aria-label="Summary">
            <button
              type="button"
              onClick={summarize}
              disabled={busy}
              className="btn btn-sm btn-outline"
            >
              Summarize unread
            </button>
            <TaskResult state={summary.state} label="Summary" />
          </section>

          <section className="space-y-2" aria-label="Ask">
            {turns.map((turn, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-2xl px-3 py-2 text-sm',
                  turn.role === 'user' ? 'ml-8 bg-primary/10' : 'mr-8 bg-base-content/5',
                )}
              >
                <p className="whitespace-pre-wrap break-words">{turn.content}</p>
                {turn.role === 'assistant' && (
                  <ModelTag label={turn.model ?? null} className="mt-1" />
                )}
              </div>
            ))}
            {/* The answer being written; once done it is part of `turns`. */}
            {answer.state.status !== 'done' && <TaskResult state={answer.state} label="Answer" />}

            <form onSubmit={ask} className="flex items-center gap-2" aria-label="Ask a question">
              <label htmlFor="flick-question" className="sr-only">
                Ask Flick a question
              </label>
              <input
                id="flick-question"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
                maxLength={2000}
                placeholder="Ask anything…"
                autoComplete="off"
                className="input-soft flex-1"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="btn-grad grid size-10 place-items-center rounded-full disabled:opacity-40"
                aria-label="Send question"
              >
                <Send className="size-4" aria-hidden="true" />
              </button>
            </form>
            <label className="flex items-center gap-2 text-xs text-base-content/60">
              <input
                type="checkbox"
                checked={useChat}
                onChange={(e) => {
                  setUseChat(e.target.checked);
                }}
              />
              Let Flick read the latest messages of this chat
            </label>
            <p className="text-xs text-base-content/50">
              Messages you send here may be processed by an AI provider.
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
};
