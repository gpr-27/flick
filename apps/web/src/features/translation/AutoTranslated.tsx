import { useState } from 'react';
import { Languages } from 'lucide-react';
import { useAutoTranslation } from './autoTranslate';

/**
 * Under an incoming text message, when this chat is translated for me: the translation, with
 * "Show original" to hide it. Renders nothing when auto-translate is off or nothing needs translating.
 */
export const AutoTranslated = ({
  conversationId,
  messageId,
  text,
}: {
  conversationId: string;
  messageId: string;
  text: string;
}) => {
  const [hidden, setHidden] = useState(false);
  const { translated, pending } = useAutoTranslation(conversationId, messageId, text, !hidden);
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => {
          setHidden(false);
        }}
        className="mt-1 flex items-center gap-1 text-xs font-semibold underline"
      >
        <Languages className="size-3" aria-hidden="true" />
        Translate
      </button>
    );
  }
  if (pending) return <p className="mt-1 text-xs opacity-60">Translating…</p>;
  if (!translated) return null;
  return (
    <div className="mt-1 border-t border-base-content/10 pt-1 text-sm" aria-label="Translation">
      <p className="whitespace-pre-wrap break-words italic">{translated}</p>
      <button
        type="button"
        onClick={() => {
          setHidden(true);
        }}
        className="mt-1 flex items-center gap-1 text-xs font-semibold underline"
      >
        <Languages className="size-3" aria-hidden="true" />
        Show original
      </button>
    </div>
  );
};
