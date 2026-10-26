import { useEffect, useRef, useState } from 'react';
import { composeText } from '../aiApi';
import { useAiEnabled } from '../useAiEnabled';
import { readGhostSetting } from './writingApi';
import { joinSuggestion } from './writingText';

const PAUSE_MS = 600;
const MIN_CHARS = 8;
const MAX_CHARS = 400;

/**
 * "Suggest as I type" (off by default, Settings in the Write bar): 600 ms after you stop typing, a
 * grey continuation is shown above the box; Tab (or a tap) puts it in. The server limits how often
 * this can ask and prefers its fastest model. A failed call is silent.
 */
export const GhostText = ({
  text,
  conversationId,
  onAccept,
}: {
  text: string;
  conversationId: string;
  onAccept: (next: string) => void;
}) => {
  const enabled = useAiEnabled();
  const active = enabled === true && readGhostSetting();
  const [ghost, setGhost] = useState<{ for: string; text: string } | null>(null);
  const shown = ghost && ghost.for === text ? ghost.text : '';
  const current = useRef({ text, shown, onAccept });
  useEffect(() => {
    current.current = { text, shown, onAccept };
  });

  useEffect(() => {
    const draft = text.trimEnd();
    const skip =
      !active ||
      draft.length < MIN_CHARS ||
      draft.length > MAX_CHARS ||
      /^[/@]/.test(draft) ||
      /\n\s*$/.test(text);
    if (skip) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      composeText(
        { mode: 'complete', text: draft, conversation_id: conversationId },
        controller.signal,
      )
        .then((r) => {
          const piece = joinSuggestion(text, r.text);
          if (piece) setGhost({ for: text, text: piece });
        })
        .catch(() => {
          // optional help: a failed or rate-limited call is silent
        });
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, text, conversationId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const { shown: s, text: t, onAccept: accept } = current.current;
      if (!s || e.key !== 'Tab' || e.shiftKey) return;
      if ((e.target as HTMLElement | null)?.id !== 'composer-input') return;
      e.preventDefault();
      accept(t + s);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!shown) return null;
  const tail = text.slice(-24);
  return (
    <button
      type="button"
      onClick={() => {
        onAccept(text + shown);
      }}
      aria-label={`Accept suggestion: ${shown.trim()}`}
      className="mb-1 flex max-w-full items-center gap-2 self-start rounded-full bg-sunken px-3 py-1 text-left text-sm"
    >
      <span className="min-w-0 truncate">
        <span className="text-[var(--text-3)]">…{tail}</span>
        <span className="text-[var(--text-2)] opacity-70">{shown}</span>
      </span>
      <kbd className="kbd kbd-xs shrink-0 max-sm:hidden">Tab</kbd>
    </button>
  );
};
