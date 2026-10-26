import { useEffect, useState, type FormEvent } from 'react';
import { Modal, Spinner } from '@/components/ui';
import { askFlick, summarizeUnread } from './aiApi';
import { ModelTag } from './ModelTag';
import { useAiEnabled } from './useAiEnabled';
import { useAiTask } from './useAiTask';

const Shell = ({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) => (
  <Modal
    open={open}
    onClose={onClose}
    label={title}
    className="glass-card mx-4 flex w-full max-w-md flex-col gap-3 rounded-3xl p-5 text-sm animate-scale-in"
  >
    <h2 className="font-display text-lg font-bold">{title}</h2>
    {children}
    <button type="button" className="btn btn-ghost min-h-[44px]" onClick={onClose}>
      Close
    </button>
  </Modal>
);

/** Shows the answer, loading and error states of an AI task. */
const Answer = ({ task }: { task: ReturnType<typeof useAiTask> }) => (
  <>
    {task.state.status === 'loading' && task.state.text === '' && (
      <Spinner size="sm" label="Flick is reading" />
    )}
    {task.state.text !== '' && (
      <p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words leading-6">
        {task.state.text}
      </p>
    )}
    {task.state.status === 'done' && <ModelTag label={task.state.model} />}
    {task.state.status === 'error' && (
      <p role="alert" className="text-error">
        {task.state.notConfigured ? 'AI is not set up on this server.' : task.state.error}
      </p>
    )}
  </>
);

/** "Summarise chat": bullet points of what you have not read (or the latest messages). */
export const SummariseChatDialog = ({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const enabled = useAiEnabled();
  const task = useAiTask();
  const { run, reset } = task;

  useEffect(() => {
    if (!open || enabled !== true) return;
    void run(({ signal, onText, onModel }) =>
      summarizeUnread(conversationId, { signal, onText, onModel }),
    );
    return reset;
  }, [open, enabled, conversationId, run, reset]);

  return (
    <Shell title="Chat summary" open={open} onClose={onClose}>
      {enabled === false ? (
        <p role="status">AI is not set up on this server.</p>
      ) : (
        <Answer task={task} />
      )}
    </Shell>
  );
};

/** "Ask Flick about this chat": a question answered from the latest messages of the chat. */
export const AskAboutChatDialog = ({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const enabled = useAiEnabled();
  const task = useAiTask();
  const [question, setQuestion] = useState('');

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const q = question.trim();
    if (!q || task.state.status === 'loading') return;
    void task.run(({ signal, onText, onModel }) =>
      askFlick(
        [
          {
            role: 'user',
            content: `Answer in one or two short sentences, using only the chat messages you were given. If they do not say, say you cannot tell.\n\nQuestion: ${q}`,
          },
        ],
        conversationId,
        { signal, onText, onModel },
      ),
    );
  };

  return (
    <Shell title="Ask about this chat" open={open} onClose={onClose}>
      {enabled === false ? (
        <p role="status">AI is not set up on this server.</p>
      ) : (
        <>
          <form onSubmit={submit} className="flex gap-2">
            <input
              type="text"
              value={question}
              maxLength={500}
              autoFocus
              aria-label="Your question"
              placeholder="What time did we decide?"
              onChange={(e) => {
                setQuestion(e.target.value);
              }}
              className="input-soft min-w-0 flex-1 text-base sm:text-sm"
            />
            <button
              type="submit"
              className="btn btn-primary min-h-[44px]"
              disabled={!question.trim() || task.state.status === 'loading'}
            >
              Ask
            </button>
          </form>
          <Answer task={task} />
        </>
      )}
    </Shell>
  );
};
