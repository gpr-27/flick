import { useEffect, useState, type RefObject } from 'react';

export interface TextSelection {
  start: number;
  end: number;
}

/** The selected range of the text field while it has focus and something is selected; else null. */
export const useTextSelection = (
  ref: RefObject<HTMLTextAreaElement | null>,
  enabled: boolean,
  text: string,
): TextSelection | null => {
  const [found, setFound] = useState<(TextSelection & { text: string }) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const update = (): void => {
      const field = ref.current;
      if (!field || document.activeElement !== field) return;
      const { selectionStart: start, selectionEnd: end } = field;
      setFound(
        end - start >= 2 && field.value.slice(start, end).trim()
          ? { start, end, text: field.value }
          : null,
      );
    };
    const clear = (): void => {
      setFound(null);
    };
    const field = ref.current;
    document.addEventListener('selectionchange', update);
    field?.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('selectionchange', update);
      field?.removeEventListener('blur', clear);
    };
  }, [ref, enabled]);

  // Typing changes the text; a selection taken from older text no longer counts.
  return enabled && found?.text === text ? found : null;
};
