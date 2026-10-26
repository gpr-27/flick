import { useRef, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { PollContent, type MessageContent } from '@chat/contracts';
import { Modal } from '@/components/ui';

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;

const CLOSE_CHOICES = [
  [0, 'Never'],
  [1, 'In 1 hour'],
  [24, 'In 1 day'],
  [168, 'In 1 week'],
] as const;

type Poll = Extract<MessageContent, { type: 'poll' }>;

export const PollComposer = ({
  open,
  onClose,
  onCreate,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (poll: Poll) => void;
  /** A drafted poll ("Poll from question") to start from. */
  initial?: { question: string; options: string[] };
}) => {
  const [question, setQuestion] = useState(initial?.question ?? '');
  const [options, setOptions] = useState(initial?.options ?? ['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [closeHours, setCloseHours] = useState(0); // 0 = never closes
  const [error, setError] = useState<string | null>(null);
  const questionRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const parsed = PollContent.safeParse({
      type: 'poll',
      question,
      options: options.map((o) => o.trim()).filter(Boolean),
      allow_multiple: allowMultiple,
      ...(closeHours > 0 && {
        closes_at: new Date(Date.now() + closeHours * 3_600_000).toISOString(),
      }),
    });
    if (!parsed.success) {
      setError(
        question.trim()
          ? 'Give at least two different options.'
          : 'Write a question and at least two options.',
      );
      return;
    }
    onCreate(parsed.data);
    setQuestion('');
    setOptions(['', '']);
    setAllowMultiple(false);
    setCloseHours(0);
    setError(null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="poll-title"
      initialFocusRef={questionRef}
      className="glass-card mx-4 w-full max-w-md rounded-3xl p-6 animate-scale-in"
    >
      <form onSubmit={submit}>
        <div className="mb-4 flex items-center justify-between">
          <h2 id="poll-title" className="font-display text-xl font-bold">
            Create poll
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

        <label htmlFor="poll-question" className="mb-1 block text-sm font-semibold">
          Question
        </label>
        <input
          id="poll-question"
          ref={questionRef}
          value={question}
          maxLength={300}
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
          className="input-soft mb-3 w-full"
        />

        <div className="mb-2 space-y-2">
          {options.map((value, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={`Option ${i + 1}`}
                value={value}
                maxLength={100}
                onChange={(e) => {
                  setOptions(options.map((o, j) => (j === i ? e.target.value : o)));
                }}
                className="input-soft flex-1"
              />
              {options.length > MIN_OPTIONS && (
                <button
                  type="button"
                  onClick={() => {
                    setOptions(options.filter((_, j) => j !== i));
                  }}
                  className="btn btn-circle btn-ghost btn-xs"
                  aria-label={`Remove option ${i + 1}`}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            onClick={() => {
              setOptions([...options, '']);
            }}
            className="btn btn-ghost btn-sm mb-3 gap-1"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add option
          </button>
        )}

        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowMultiple}
            onChange={(e) => {
              setAllowMultiple(e.target.checked);
            }}
            className="checkbox checkbox-sm"
          />
          Allow multiple answers
        </label>

        <label className="mb-4 flex items-center justify-between gap-2 text-sm">
          Close poll
          <select
            value={closeHours}
            onChange={(e) => {
              setCloseHours(Number(e.target.value));
            }}
            className="select select-sm"
          >
            {CLOSE_CHOICES.map(([hours, label]) => (
              <option key={hours} value={hours}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p role="alert" className="mb-3 text-sm text-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-grad h-11 rounded-2xl px-5 font-semibold text-white">
            Send poll
          </button>
        </div>
      </form>
    </Modal>
  );
};
