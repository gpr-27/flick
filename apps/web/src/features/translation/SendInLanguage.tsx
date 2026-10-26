import { useState } from 'react';
import { Languages } from 'lucide-react';
import type { MessageContent } from '@chat/contracts';
import { getErrorMessage } from '@/lib/api';
import { LANGUAGES } from '@/features/ai/languages';
import { translateBatch } from './translationApi';

type TextContent = Extract<MessageContent, { type: 'text' }>;

/**
 * "Send in <language>" above the composer: the draft is translated before it is sent. The message
 * carries the translation as its text for everyone, and the original for the sender, who keeps
 * seeing what they wrote.
 */
export const SendInLanguage = ({
  text,
  onSend,
}: {
  text: string;
  onSend: (content: TextContent) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<string>('Spanish');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = text.trim();
  if (!draft) return null;

  const send = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const out = await translateBatch([{ id: 'draft', text: draft }], language, false);
      const translated = out.get('draft');
      if (!translated) throw new Error('empty');
      onSend({ type: 'text', text: translated, original_text: draft, translated_to: language });
      setOpen(false);
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't translate. Nothing was sent."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="mb-1 flex items-center gap-1 self-start px-2 text-xs font-semibold text-primary-text"
      >
        <Languages className="size-3.5" aria-hidden="true" />
        Send in another language
      </button>
    );
  }
  return (
    <div
      className="mb-1 flex flex-wrap items-center gap-2 px-2 text-sm"
      role="group"
      aria-label="Send in a language"
    >
      <select
        value={language}
        onChange={(e) => {
          setLanguage(e.target.value);
        }}
        aria-label="Language to send in"
        className="select select-bordered select-sm min-h-[44px]"
      >
        {LANGUAGES.map((l) => (
          <option key={l}>{l}</option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-primary btn-sm min-h-[44px]"
        disabled={busy}
        onClick={() => void send()}
      >
        {busy ? 'Translating…' : `Send in ${language}`}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-[44px]"
        onClick={() => {
          setOpen(false);
        }}
      >
        Cancel
      </button>
      {error && (
        <p role="alert" className="w-full text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
};
