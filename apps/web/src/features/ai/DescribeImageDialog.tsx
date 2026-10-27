import { Markdown } from '@/features/content/richText/Markdown';
import { useEffect, useRef, useState } from 'react';
import { Modal, Spinner, notify } from '@/components/ui';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { sendMessage } from '@/features/chat/outbox/useOutboxStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { getApi } from '@/lib/services';
import { ENDPOINTS } from '@chat/contracts';
import { analyzeAttachment, analyzeFiles, type AnalyzeMode } from './aiApi';
import {
  PHOTO_PRESETS,
  parseMarkdownTable,
  parseReceipt,
  receiptToText,
  tableToCsv,
} from './fileTools';
import { LANGUAGES } from './languages';
import { useAiEnabled } from './useAiEnabled';
import { useAiTask } from './useAiTask';

/** The composer listens for this: `detail` is { conversationId, text }. */
export const INSERT_TEXT_EVENT = 'flick:insert-text';

/**
 * "Explain with Flick" for an image, PDF, file or voice note. Opens with Flick's default
 * explanation for the file type, then lets you ask follow-up questions about the same file.
 */
export const DescribeImageDialog = ({
  attachmentId,
  conversationId,
  open,
  onClose,
}: {
  attachmentId: string;
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const enabled = useAiEnabled();
  const task = useAiTask();
  const [question, setQuestion] = useState('');
  const started = useRef(false);
  const [extra, setExtra] = useState<string[]>([]);
  const [view, setView] = useState<AnalyzeMode>('explain');
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const messages = useChatStore((s) => s.threads[conversationId]?.messages);
  const userId = useSessionStore((s) => s.user?.id);

  // Other files sent in this chat that can be added to the question.
  const others = (messages ?? []).flatMap((m) =>
    (m.content?.type === 'image' || m.content?.type === 'file') &&
    m.content.attachment_id !== attachmentId &&
    !extra.includes(m.content.attachment_id)
      ? [
          {
            id: m.content.attachment_id,
            label: m.content.type === 'file' ? m.content.file_name : `Photo ${m.seq}`,
          },
        ]
      : [],
  );
  const labelOf = (id: string): string =>
    (messages ?? []).flatMap((m) =>
      m.content?.type === 'file' && m.content.attachment_id === id
        ? [m.content.file_name]
        : m.content?.type === 'image' && m.content.attachment_id === id
          ? ['Photo']
          : [],
    )[0] ?? 'File';

  const ask = (q?: string, mode?: AnalyzeMode, ids: string[] = extra): void => {
    setView(mode ?? 'explain');
    void task.run(({ signal }) =>
      ids.length === 0 && !mode
        ? analyzeAttachment(attachmentId, q, signal)
        : analyzeFiles(
            [attachmentId, ...ids],
            { ...(q ? { question: q } : {}), ...(mode ? { mode } : {}), language },
            signal,
          ),
    );
  };

  // Closing the dialog clears what was typed (adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setQuestion('');
      setExtra([]);
      setView('explain');
    }
  }

  useEffect(() => {
    if (!open) {
      started.current = false;
      task.reset();
      return;
    }
    if (enabled && !started.current) {
      started.current = true;
      ask();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once per opening
  }, [open, enabled]);

  const { status, text, error, notConfigured } = task.state;

  const copy = (): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        notify.success('Copied');
      })
      .catch(() => {
        notify.error('Could not copy');
      });
  };

  const table = view === 'table' && status === 'done' ? parseMarkdownTable(text) : [];
  const receipt = view === 'receipt' && status === 'done' ? parseReceipt(text) : null;

  const copyCsv = (): void => {
    void navigator.clipboard.writeText(tableToCsv(table)).then(
      () => {
        notify.success('Copied as CSV');
      },
      () => {
        notify.error('Could not copy');
      },
    );
  };
  const downloadCsv = (): void => {
    const url = URL.createObjectURL(new Blob([tableToCsv(table)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'table.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const saveReceipt = async (): Promise<void> => {
    if (!receipt || !userId) return;
    try {
      const saved = await getApi().call(ENDPOINTS.conversations.openSaved);
      sendMessage(userId, saved.id, { type: 'text', text: receiptToText(receipt) });
      notify.success('Added to Saved messages');
    } catch {
      notify.error('Could not save the receipt');
    }
  };

  const replyWith = (): void => {
    window.dispatchEvent(new CustomEvent(INSERT_TEXT_EVENT, { detail: { conversationId, text } }));
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Explain with Flick"
      className="surface-raised mx-4 flex max-h-[85vh] w-full max-w-md flex-col gap-3 rounded-3xl p-5 text-sm animate-scale-in"
    >
      <h2 className="font-display text-lg font-bold">Explain with Flick</h2>
      {enabled === false ? (
        <p role="status">AI is not set up on this server.</p>
      ) : (
        <>
          <div className="min-h-[4rem] flex-1 overflow-y-auto rounded-2xl bg-sunken p-3">
            {status === 'loading' && <Spinner size="sm" label="Flick is reading this" />}
            {status === 'done' && table.length > 1 && (
              <div className="overflow-x-auto" data-testid="table-result">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      {table[0]?.map((h, i) => (
                        <th key={i} className="border-b border-base-content/20 p-1.5 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.slice(1).map((row, r) => (
                      <tr key={r}>
                        {row.map((c, i) => (
                          <td key={i} className="border-b border-base-content/10 p-1.5">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {status === 'done' && receipt && (
              <div className="flex flex-col gap-1" data-testid="receipt-card">
                <p className="font-semibold">
                  {receipt.merchant || 'Receipt'}
                  {receipt.date ? ` · ${receipt.date}` : ''}
                </p>
                {receipt.items.map((i, n) => (
                  <p key={n} className="flex justify-between gap-2">
                    <span>{i.name}</span>
                    <span>{i.price === null ? '' : i.price.toFixed(2)}</span>
                  </p>
                ))}
                {receipt.total !== null && (
                  <p className="flex justify-between border-t border-base-content/20 pt-1 font-semibold">
                    <span>Total</span>
                    <span>
                      {receipt.currency} {receipt.total.toFixed(2)}
                    </span>
                  </p>
                )}
              </div>
            )}
            {status === 'done' && table.length <= 1 && !receipt && (
              <Markdown text={text} testId="explain-result" />
            )}
            {status === 'error' && (
              <p role="alert" className="text-error">
                {notConfigured ? 'AI is not set up on this server.' : error}
              </p>
            )}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!question.trim() || status === 'loading') return;
              ask(question);
              setQuestion('');
            }}
          >
            <input
              className="input input-bordered h-11 min-w-0 flex-1 text-base"
              placeholder="Ask about this file…"
              aria-label="Ask about this file"
              maxLength={1000}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
              }}
            />
            <button
              type="submit"
              className="btn btn-primary min-h-[44px]"
              disabled={!question.trim() || status === 'loading'}
            >
              Ask
            </button>
          </form>
          <div className="flex flex-wrap gap-2" aria-label="Quick asks">
            {PHOTO_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="pill-tab"
                disabled={status === 'loading'}
                onClick={() => {
                  setQuestion(p.question);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-label="File actions">
            {(
              [
                ['Extract table', 'table'],
                ['Highlight key terms', 'highlight'],
                ['Extract receipt', 'receipt'],
              ] as const
            ).map(([label, mode]) => (
              <button
                key={mode}
                type="button"
                className="pill-tab"
                disabled={status === 'loading'}
                onClick={() => {
                  ask(undefined, mode);
                }}
              >
                {label}
              </button>
            ))}
            {extra.length > 0 && (
              <button
                type="button"
                className="pill-tab"
                disabled={status === 'loading'}
                onClick={() => {
                  ask(undefined, 'compare');
                }}
              >
                Compare versions
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              className="select select-bordered select-sm min-w-0 flex-1"
              aria-label="Translate into"
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <button
              type="button"
              className="pill-tab"
              disabled={status === 'loading'}
              onClick={() => {
                ask(undefined, 'translate');
              }}
            >
              Translate
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {extra.map((id) => (
              <button
                key={id}
                type="button"
                className="pill-tab"
                aria-label={`Remove ${labelOf(id)}`}
                onClick={() => {
                  setExtra(extra.filter((e) => e !== id));
                }}
              >
                {labelOf(id)} ×
              </button>
            ))}
            {others.length > 0 && extra.length < 3 && (
              <select
                className="select select-bordered select-sm min-w-0 flex-1"
                aria-label="Add another file"
                value=""
                onChange={(e) => {
                  if (e.target.value) setExtra([...extra, e.target.value]);
                }}
              >
                <option value="">Add another file…</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {table.length > 1 && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost min-h-[44px] text-primary-text"
                  onClick={copyCsv}
                >
                  Copy CSV
                </button>
                <button
                  type="button"
                  className="btn btn-ghost min-h-[44px] text-primary-text"
                  onClick={downloadCsv}
                >
                  Download CSV
                </button>
              </>
            )}
            {receipt && (
              <button
                type="button"
                className="btn btn-ghost min-h-[44px] text-primary-text"
                onClick={() => void saveReceipt()}
              >
                Add to Saved messages
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost min-h-[44px] text-primary-text"
              disabled={status !== 'done'}
              onClick={copy}
            >
              Copy
            </button>
            <button
              type="button"
              className="btn btn-ghost min-h-[44px] text-primary-text"
              disabled={status !== 'done'}
              onClick={replyWith}
            >
              Reply with this
            </button>
          </div>
        </>
      )}
      <button type="button" className="btn btn-ghost min-h-[44px]" onClick={onClose}>
        Close
      </button>
    </Modal>
  );
};
